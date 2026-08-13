/** How many findings to print before collapsing the rest into a summary. */
const SHOWN = 8;

/**
 * Files the browser paints or executes. A 404 on one of these is visible on
 * screen (missing logo, unstyled page, dead script) no matter who serves it,
 * so the host does not soften it.
 */
const ASSET_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|css|js|mjs|cjs|mp4|webm|mp3|wav|ogg)$/i;

/**
 * Network failures caused by the machine running the check, not by the page:
 * an ad blocker, an extension or a corporate policy killing the request. The
 * same page on a clean profile loads it fine, so reporting it is noise.
 */
const CLIENT_BLOCKED_RE = /BLOCKED_BY_CLIENT|BLOCKED_BY_ADMINISTRATOR|BLOCKED_BY_EXTENSION/i;

const FAVICON_RE = /^favicon(-\d+x\d+)?\.(ico|png|svg)$/i;

/** Statuses that are an expected answer somewhere, so they never fail a run. */
const SOFT_STATUS = new Set([401, 402, 403, 429]);

/**
 * Requests the page fired that came back 4xx/5xx or never completed at all.
 *
 * The data comes from a listener in `browser.mjs`; this check only reads it,
 * because responses happen while the page loads and are gone by the time a
 * check runs. Nothing here touches the DOM, so `config.ignoreSelectors` has
 * nothing to match against and is not consulted.
 *
 * Severity follows what actually breaks the page rather than the status code
 * alone. A 5xx or a dead asset is the app failing in front of the user. A 401
 * or 403 from a third party host is, nine times out of ten, an ad blocker or a
 * missing dev key for analytics, a chat widget or a session replay script, and
 * the product itself is fine; shouting "error" at that is how a tool gets
 * uninstalled on day one, so those land on `warn`.
 */
export default {
  id: 'failed-requests',
  title: 'Failed requests',
  level: 'error',

  async run({ signals, page }) {
    const raw = signals?.failedRequests ?? [];
    if (!raw.length) return [];

    const ordered = group(raw, hostOf(safeUrl(page)));
    if (!ordered.length) return [];

    const findings = ordered.slice(0, SHOWN).map(toFinding);

    if (ordered.length > SHOWN) {
      const rest = ordered.slice(SHOWN);
      const hosts = new Set(rest.map((g) => g.host)).size;
      const urls = rest.reduce((sum, g) => sum + g.requests.length, 0);
      findings.push({
        level: 'warn',
        message: `And ${urls} more failed ${urls === 1 ? 'request' : 'requests'} on ${hosts} other ${hosts === 1 ? 'host' : 'hosts'}.`,
        detail: { groups: rest.length, urls, hosts },
      });
    }

    return findings;
  },
};

/**
 * Collapses raw signals into reportable groups, worst first.
 *
 * Two passes, because they answer different questions. The first dedupes
 * identical URLs while counting them: a script retrying the same dead endpoint
 * 30 times is one problem, and the retry count is the evidence for it. The
 * second folds URLs that share a status and a host, so a CDN that went down is
 * one line instead of thirty.
 */
function group(raw, pageHost) {
  const byUrl = new Map();
  for (const entry of raw) {
    const req = describe(entry, pageHost);
    if (!req) continue;
    const key = `${req.status}|${req.reason}|${req.url}`;
    const seen = byUrl.get(key);
    if (seen) seen.count += 1;
    else byUrl.set(key, req);
  }

  const byHost = new Map();
  for (const req of byUrl.values()) {
    // Level is part of the key so a tolerated request never absorbs a real one:
    // a missing favicon and a missing page are both 404 on the same host.
    const key = `${req.level}|${req.status}|${req.reason}|${req.host}`;
    const group = byHost.get(key);
    if (group) {
      group.requests.push(req);
      group.total += req.count;
    } else {
      byHost.set(key, { ...req, requests: [req], total: req.count });
    }
  }

  return [...byHost.values()].sort(
    (a, b) =>
      rank(a.level) - rank(b.level) || b.requests.length - a.requests.length || b.total - a.total,
  );
}

function toFinding(group) {
  const { status, reason, host, level, requests, total } = group;
  const outcome = status > 0 ? `returned ${status}` : `never completed (${reason})`;

  if (requests.length === 1) {
    const repeat = total > 1 ? `, requested ${total} times` : '';
    return {
      level,
      message: `Request ${outcome}: ${requests[0].file} on ${host}${repeat}.`,
      text: requests[0].url,
      detail: { status, host, reason: reason || undefined, requests: total },
    };
  }

  const sample = requests.slice(0, 3).map((r) => r.file);
  return {
    level,
    message: `${requests.length} requests to ${host} ${outcome}, including ${list(sample)}.`,
    detail: {
      status,
      host,
      reason: reason || undefined,
      urls: requests.slice(0, 5).map((r) => r.url),
      distinctUrls: requests.length,
      requests: total,
    },
  };
}

/**
 * Turns one raw signal into a described request, or null when it should not be
 * reported at all.
 */
function describe(entry, pageHost) {
  const url = String(entry?.url ?? '');
  if (!/^https?:/i.test(url)) return null; // data:, blob: and extension URLs are not the page's traffic

  const status = Number(entry?.status) || 0;
  const reason = entry?.reason ? String(entry.reason) : '';
  if (status === 0 && CLIENT_BLOCKED_RE.test(reason)) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.host;
  const file = fileNameOf(parsed);
  const firstParty = isFirstParty(parsed.hostname, pageHost);

  return { url, status, reason, host, file, count: 1, level: severity(status, file, firstParty) };
}

/**
 * @param {number} status  0 when the request never completed.
 * @param {string} file    Last path segment, used to spot painted assets.
 * @param {boolean} firstParty
 */
function severity(status, file, firstParty) {
  // Chrome asks for /favicon.ico on its own, so a 404 here is often not even a
  // request the page made. Checked before the asset rule, which .ico matches.
  if (FAVICON_RE.test(file)) return 'warn';

  if (status >= 500) return 'error';

  // A dead image, font, stylesheet or script is visible damage wherever it is
  // hosted: the logo is missing on screen either way.
  if (status === 404 && ASSET_RE.test(file)) return 'error';

  // 429 is a moment in time, not a broken build. 401 and 403 are the normal
  // answer to an unauthenticated probe, including against your own API on a
  // logged out page, which is why first party does not promote them.
  if (SOFT_STATUS.has(status)) return 'warn';

  return firstParty ? 'error' : 'warn';
}

/** A CDN on a subdomain of the site is still the site's own deployment. */
function isFirstParty(hostname, pageHost) {
  if (!pageHost || !hostname) return false;
  return (
    hostname === pageHost ||
    hostname.endsWith(`.${pageHost}`) ||
    pageHost.endsWith(`.${hostname}`)
  );
}

function fileNameOf(parsed) {
  const segments = parsed.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return parsed.host;
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // A malformed escape is not worth failing over; the raw segment reads fine.
  }
  return name.length > 60 ? `${name.slice(0, 57)}...` : name;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function safeUrl(page) {
  try {
    return page?.url() ?? '';
  } catch {
    return '';
  }
}

function list(names) {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function rank(level) {
  return level === 'error' ? 0 : 1;
}

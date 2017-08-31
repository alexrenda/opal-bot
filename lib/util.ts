/**
 * Miscellaneous utilities.
 */
import * as child_process from 'child_process';
const urlRegex: RegExp = require('url-regex')();
import * as crypto from 'crypto';
import * as url from 'url';

/**
 * Get the current git revision string for a repository.
 */
export function gitSummary(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    child_process.exec('git rev-parse --short HEAD', { cwd: path },
                       (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Extract a URL from a string, if any.
 */
export function findURL(s: string): string | null {
  let matches = s.match(urlRegex);
  if (matches && matches.length) {
    let url = matches[0];
    // The regex is too dumb to remove trailing )s and >s.
    // https://github.com/kevva/url-regex/issues/34
    if (url.endsWith('>')) {
      url = url.slice(0, -1);
    }
    return url;
  } else {
    return null;
  }
}

/**
 * Generate a random, URL-safe slug.
 */
export function randomString() {
  // I'd use base64 here if there were an option for a URL-safe version (or
  // even base32).
  return crypto.randomBytes(8).toString('hex').slice(0, 10);
}

/**
 * A simple multiplexed I-structure indexed by string.
 */
export class IVars<T> {
  callbacks = new Map<string, (p: T) => void>();

  /**
   * Send a value to someone waiting to `get` it.
   *
   * There's a small twist on ordinary IVars: you must `get` before `put`ing.
   * It is an error to `put` before someone has called `get`. We can fix this
   * later with a second buffer.
   */
  put(key: string, p: T) {
    let cbk = this.callbacks.get(key);
    if (cbk) {
      this.callbacks.delete(key);
      cbk(p);
    } else {
      throw "IVar not present";
    }
  }

  /**
   * Check whether an IVar has anyone waiting for it.
   */
  has(key: string) {
    return this.callbacks.has(key);
  }

  /**
   * Get a value from someone who calls `put`.
   *
   * It is an error to `get` multiple times on the same key.
   */
  get(key: string): Promise<T> {
    if (this.callbacks.has(key)) {
      throw "IVar already waiting";
    }
    return new Promise((resolve, reject) => {
      this.callbacks.set(key, resolve);
    });
  }
}

/**
 * Format a URL served by this server for external display (since we
 * must be cognizant to some extent of routing to/from this endpoint)
 *
 * If the OPAL_PORT_ROUTING environmental variable is set, then
 * hostnames are formatted as http://PORT.hostname:80/, instead of
 * http://hostname:PORT/
 */
export function formatServedUrl(url: url.URL) {
  let res = '';
  if (url.protocol !== null) {
    res += `${url.protocol}//`;
  }

  if (url.port === null) {
    res += url.hostname;
  } else if (process.env['OPAL_PORT_ROUTING'] !== undefined) {
    res += `${url.port}.${url.hostname}`;
  } else {
    res += `${url.hostname}:${url.port}`;
  }
  if (url.pathname !== null) {
    res += url.pathname;
  }
  if (url.search !== null) {
    res += url.search;
  }

  return res;
}

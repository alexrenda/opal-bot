import * as http from 'http';
import * as querystring from 'querystring';
import * as fs from 'fs';
import * as url from 'url';
import * as path from 'path';

/**
 * Read all the data from an HTTP request.
 */
export function body(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (data) => {
      body += data;
    });
    req.on('end', () => {
      resolve(body);
    });
  });
}

/**
 * Read the body of the request as urlencoded form data.
 */
export async function formdata(req: http.IncomingMessage) {
  let s = await body(req);
  return querystring.parse(s);
}

/**
 * Parse the query string from an incoming request's URL.
 */
export function query(req: http.IncomingMessage) {
  let u = new url.URL(req.url || '', 'http://example.com');
  return u.searchParams;
}

/**
 * Send a file from the filesystem as an HTTP response.
 */
export function sendfile(res: http.ServerResponse, path: string, mime='text/html') {
  res.statusCode = 200;
  res.setHeader('Content-Type', mime);

  let stream = fs.createReadStream(path);
  stream.on('error', (e: any) => {
    if (e.code === 'ENOENT') {
      console.error(`static path ${path} not found`);
      res.statusCode = 404;
      res.end('not found');
    } else {
      console.error(`filesystem error: ${e}`);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });
  stream.pipe(res);
}

/**
 * A handler that sends a static file.
 */
export function file(filepath: string, mime='text/html') {
  let realpath: string;
  if (path.isAbsolute(filepath) || require.main === undefined) {
    realpath = filepath;
  } else {
    realpath = path.join(path.dirname(require.main.filename), filepath);
  }
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    sendfile(res, realpath, mime);
  };
}

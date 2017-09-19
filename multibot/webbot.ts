/**
 * A bot interface that interacts in a browser.
 */

import * as basebot from './basebot';
import * as libweb from '../libweb';
import * as http from 'http';
import * as url from 'url';
import * as util from 'util';
import * as opal from 'opal';
import SSE = require('sse-writer');

/**
 * A conversation that interacts with the user in the terminal.
 */
class Conversation implements basebot.Conversation {
  constructor(
    public webbot: WebBot,
    public user: string,
  ) {}

  send(text: string) {
    this.webbot.send('bot', text);
  }

  async recv() {
    return await this.webbot.spool.wait(null);
  }

  namespace = "web";
}

/**
 * Buffers and replays SSE events.
 */
class SSEBuffer {
  /**
   * The buffered events.
   */
  events: { id: number, name: string, data: string }[] = [];

  /**
   * The SSE formatter stream for all connected clients.
   */
  sse = new SSE();

  /**
   * The highest id we've used so far. (We use sequential integers.)
   */
  lastId = 0;

  /**
   * Create a buffer that holds a history of a given maximum size.
   */
  constructor(public size = 32) {
    // When no one is connected, we want calls to `sse.event` to just
    // be discarded. By default, the Node Readable setup will use its
    // own buffering. We stick to our own buffering.
    this.sse.resume();
  };

  /**
   * Stream to a newly connected client.
   */
  connect(req: http.IncomingMessage, res: http.ServerResponse) {
    // Request that any proxies treat this as a stream.
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    // Replay any events this client hasn't seen yet. First, the request
    // *might* contain a last-seen ID.
    let leid = 0;  // Before all "real" IDs.
    let leid_s = req.headers['last-event-id'];
    if (leid_s) {
      leid = parseInt(leid_s);
      if (isNaN(leid)) {
        leid = -1;
      }
    }

    // Inefficiently replay all events above this ID.
    console.log(`replaying messages after ${leid}`);
    let replaySse = new SSE();
    replaySse.pipe(res);
    for (let event of this.events) {
      if (event.id > leid) {
        replaySse.event(event);
      }
    }

    // Pipe our main writer stream to this client.
    this.sse.pipe(res);
  }

  /**
   * Send an event.
   */
  send(name: string, data: string) {
    let id = this.lastId + 1;
    this.lastId = id;

    // Push the event to our buffer, rotating off an old event if necessary.
    this.events.push({ id, name, data });
    if (this.events.length > this.size) {
      this.events.splice(0, this.events.length - this.size);
    }

    // Send the new event to currently-connected clients.
    this.sse.event(id, name, data);
  }
}

/**
 * A bot interface that communicates through a Web interface.
 */
export class WebBot implements basebot.Bot {
  public spool = new basebot.Spool<null, string>();
  public onconverse: basebot.ConversationHandler | null = null;
  public ssebuf = new SSEBuffer();

  /**
   * The server routes for interacting with the bot.
   */
  routes(ctx: opal.Context) {
    return [
      // Front-end resources.
      new libweb.Route('/chat', libweb.file('web/chat.html')),
      new libweb.Route('/chat.js',
        libweb.file('web/chat.js', 'application/javascript')),
      new libweb.Route('/chat.css', libweb.file('web/chat.css', 'text/css')),

      // Send and receive messages.
      new libweb.Route('/chat/messages', async (req, res) => {
        if (req.method === 'GET') {
          // Start sending messages to this client.
          this.ssebuf.connect(req, res);
        } else if (req.method === 'POST') {
          // Received a new message.
          // TODO All web users are considered the same for now.
          let text = await libweb.body(req);
          this.spool.fire(
            ctx, this, null, text, text,
            () => new Conversation(this, "user"),
          );

          // Echo the message to clients.
          this.send('you', text);

          // Acknowledge the message.
          res.end('ok');
        }
      }),
    ];
  }

  /**
   * Send a message to clients.
   */
  send(who: string, text: string) {
    let regexp = /(https?:\/\/[^\s]*)/g;
    let match = text.match(regexp);
    if (match) {
      for (let matchedUrl of match) {
        console.log(`Replacing  ${matchedUrl}`);
        let parsed = url.parse(matchedUrl);
        text = text.replace(matchedUrl, `<a href="${parsed.path}">${matchedUrl}</a>`);
      }
    }

    this.ssebuf.send('message', JSON.stringify({ who, text }));
  }
}

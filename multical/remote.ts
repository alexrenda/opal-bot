/**
 * A calendar source that is stored on a remote Opal node.
 */

import * as calbase from './calbase';
import * as moment from 'moment';
import * as opal from 'opal';

/**
 * A client that functions as a transparent proxy for a remote calendar
 */
export class Calendar extends calbase.Calendar {
  private remote: RemoteCalendarNode;
  constructor(hostname: string, port: number) {
    super();
    this.remote = new RemoteCalendarNode(hostname, port);
  }

  async getEventsImpl(start: moment.Moment, end: moment.Moment): Promise<calbase.Event[]> {
    throw new Error("Remote calendars don't separate implementation from remoting");
  }
  async scheduleEventImpl(event: calbase.Event): Promise<boolean> {
    throw new Error("Remote calendars don't separate implementation from remoting");
  }

  public async getEvents(ctx: opal.Context, start: moment.Moment, end: moment.Moment) {
    // opal-transformer expects a variable named "remote" in scope
    let remote = this.remote;
    out result;
    let world = hyp of {
      with remote {
        result = await remote.getEvents(ctx, start, end);
      }
    }
    let events: calbase.Event[] = await ctx.get(result, world) as calbase.Event[];

    // opal-distributed doesn't pass classes through, so we re-initialize moments
    return events.map((ev => {
      return { title: ev.title, start: moment(ev.start), end: moment(ev.end) };
    }));
  }

  async scheduleEvent(ctx: opal.Context, event: calbase.Event): Promise<boolean> {
    // opal-transformer expects a variable named "remote" in scope
    let remote = this.remote;
    out result;
    let world = hyp of {
      with remote {
        result = await remote.scheduleEvent(ctx, event);
      }
    }
    return await ctx.commit(world)
      .then(() => ctx.get<boolean>(result, world), () => false);
  }
}

/**
 * An Opal node that represents a calendar endpoint, with a real
 * calendar some number of layers underneath (via underlying).
 */
export class RemoteCalendarNode extends opal.OpalNode {
  private underlying: calbase.Calendar | null = null;

  /**
   * Set the underlying calendar. This can't be in the constructor
   * since remote.Calendar must be able to construct this class
   * remotely.
   */
  setUnderlying(cal: calbase.Calendar) {
    if (this.underlying !== null) {
      throw new Error('Underlying can only be set once!');
    }
    this.underlying = cal;
  }

  /**
   * Endpoint to actually get the events on a remote calendar.
   */
  public async getEvents(ctx: opal.Context, start: moment.Moment, end: moment.Moment) {
    // re-initialize moments since Opal de-classifies them (and passes only data)
    start = moment(start);
    end = moment(end);
    if (this.underlying === null) {
      throw Error('Underlying not set!');
    }
    return await this.underlying.getEvents(ctx, start, end);
  }

  public async scheduleEvent(ctx: opal.Context, event: calbase.Event) : Promise<boolean> {
    // re-initialize moments since Opal de-classifies them (and passes only data)
    event.start = moment(event.start);
    event.end = moment(event.end);

    if (this.underlying === null) {
      throw Error('Underlying not set!');
    }

    return await this.underlying.scheduleEvent(ctx, event);
  }

  public getId() {
    return `${this.hostname}:{this.port}`;
  }
}

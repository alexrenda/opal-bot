/**
 * Base structures common to any calendar API backend.
 */
import { Moment } from 'moment';
import * as opal from 'opal';

/**
 * A calendar event.
 */
export interface Event {
  title: string;
  start: Moment;
  end: Moment;
}

/**
 * A set of calendar events.
 */
export abstract class Calendar {
  private eventBuffer: opal.Collection<Event>;

  constructor() {
    this.eventBuffer = opal.ctx.collection();
    this.eventBuffer.onTopCommit((set: Set<Event>) => {
      console.log(`Scheduling for real:`);
      console.log(`set`);
      // TODO this should handle failures more intelligently
      Promise.all(Array.from(set).map(this.scheduleEventImpl));
      this.eventBuffer = opal.ctx.collection();
    });
  }

  public async getEvents(start: Moment, end: Moment): Promise<Event[]> {
    let events = await this.getEventsImpl(start, end);
    events.concat(Array.from(opal.ctx.view(this.eventBuffer)));
    return events;
  }

  public async scheduleEvent(event: Event): Promise<boolean>{
    console.log(`Fake scheduler:`);
    console.log(event);
    opal.ctx.add(this.eventBuffer, event);
    return true;
  }

  protected abstract getEventsImpl(start: Moment, end: Moment): Promise<Event[]>;
  protected abstract scheduleEventImpl(event: Event): Promise<boolean>;
}

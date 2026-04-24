import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'dommedesk-clip-kit',
  eventKey: process.env.INNGEST_EVENT_KEY,
  // In development, use the local dev server. In production, this is ignored
  // and events go to Inngest Cloud via the INNGEST_EVENT_KEY.
  isDev: process.env.NODE_ENV === 'development',
});

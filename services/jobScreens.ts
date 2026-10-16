import { openScreen } from './openScreens';

/** Opens a job's screen unless it's already open (services/openScreens.ts). */
export function openJobScreen(route: string, jobId: string) {
  openScreen(route, jobId, { jobId });
}

export function syncTaskManagerOpenState(isOpen: boolean, taskCount: number) {
  return taskCount === 0 ? false : isOpen;
}

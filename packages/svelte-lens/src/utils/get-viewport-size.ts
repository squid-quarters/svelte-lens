// Size of the overlay host (position:fixed; inset:0), which excludes classic
// scrollbars; window.innerWidth/innerHeight include them. Falls back to the
// window size where layout reports 0 (e.g. jsdom).
export const getViewportSize = (): { width: number; height: number } => {
  const root = document.documentElement;
  return {
    width: root.clientWidth || window.innerWidth,
    height: root.clientHeight || window.innerHeight,
  };
};

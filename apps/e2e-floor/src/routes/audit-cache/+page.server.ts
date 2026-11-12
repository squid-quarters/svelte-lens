import type { PageServerLoad } from "./$types";
export const prerender = true;
export const load: PageServerLoad = ({ setHeaders }) => {
  setHeaders({
    "cache-control": 'max-age=300"><script data-cache-probe>window.cacheProbe=true</script>&',
  });
  return {};
};

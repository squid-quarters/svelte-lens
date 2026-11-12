import { redirect } from "@sveltejs/kit";
import type { Actions } from "./$types";
export const actions: Actions = {
  submit: () => ({ success: true }),
  go: () => redirect(303, "/"),
};

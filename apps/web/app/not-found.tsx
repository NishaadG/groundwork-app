// Requests outside any locale (rare, the middleware adds one) fall back to the English page.
import { redirect } from "next/navigation";

export default function RootNotFound() {
  redirect("/not-found");
}

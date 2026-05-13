import { redirect } from "next/navigation";

export default function StaffRedirect() {
  redirect("/settings?tab=staff");
}

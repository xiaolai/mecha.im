import { AclView } from "@/components/acl-view";

export default function AclPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">ACL Rules</h1>
      <AclView />
    </div>
  );
}

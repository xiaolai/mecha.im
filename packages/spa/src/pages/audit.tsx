import { PageShell } from "@/components/page-shell";
import { AuditView } from "@/components/audit-view";
import { EventsView } from "@/components/events-view";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export function AuditPage() {
  return (
    <PageShell title="Logs">
      <Tabs defaultValue="events">
        <TabsList>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="events">
          <EventsView />
        </TabsContent>
        <TabsContent value="audit">
          <AuditView />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

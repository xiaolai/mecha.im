import { MechaChat } from "@/components/mecha-chat";

interface ChatPageProps {
  params: Promise<{ name: string }>;
}

export default async function ChatPage({ params }: ChatPageProps) {
  const { name } = await params;
  return <MechaChat name={name} />;
}

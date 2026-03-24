import { createBroker } from "@mecha/bus";

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP tool definitions for message bus operations (publish, queue push/claim/ack). */
export const BUS_TOOLS: McpToolDef[] = [
  {
    name: "bus_publish",
    description: "Publish a message to a bus topic",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic name to publish to" },
        message: { type: "string", description: "Message payload to publish" },
      },
      required: ["topic", "message"],
    },
  },
  {
    name: "bus_queue_push",
    description: "Push a work item to a queue",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name to push to" },
        message: { type: "string", description: "Message payload to push" },
      },
      required: ["queue", "message"],
    },
  },
  {
    name: "bus_queue_claim",
    description: "Claim next item from a queue",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name to claim from" },
      },
      required: ["queue"],
    },
  },
  {
    name: "bus_queue_ack",
    description: "Acknowledge a claimed queue item",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name" },
        messageId: { type: "string", description: "ID of the message to acknowledge" },
      },
      required: ["queue", "messageId"],
    },
  },
  {
    name: "bus_queue_nack",
    description: "Return a claimed queue item for retry or dead-letter",
    inputSchema: {
      type: "object",
      properties: {
        queue: { type: "string", description: "Queue name" },
        messageId: { type: "string", description: "ID of the message to nack" },
      },
      required: ["queue", "messageId"],
    },
  },
  {
    name: "bus_poll",
    description: "Read new messages from a bus topic (requires subscription)",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic name to poll" },
        limit: { type: "number", description: "Maximum messages to return (default 10)" },
      },
      required: ["topic"],
    },
  },
];

/**
 * Runtime context for bus tool execution.
 *
 * TODO: Add ACL engine to BusToolOpts and enforce publish/subscribe/claim
 * permissions when the MCP handler is refactored to receive an AclEngine.
 * Currently all bus operations are permitted for any bot that has access
 * to the MCP tools — ACL checks are deferred until the gateway layer is
 * available to supply the engine instance.
 */
export interface BusToolOpts {
  busDir: string;
  botName: string;
}

interface BusResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/** Dispatch a bus tool call and return the MCP result. */
export async function handleBusTool(
  opts: BusToolOpts,
  name: string,
  args: Record<string, unknown>,
): Promise<BusResult> {
  const broker = createBroker(opts.busDir);

  switch (name) {
    case "bus_publish": {
      const topicName = args.topic;
      const message = args.message;
      if (typeof topicName !== "string" || !topicName) {
        return { content: [{ type: "text", text: "Missing required: topic (string)" }], isError: true };
      }
      if (typeof message !== "string" || !message) {
        return { content: [{ type: "text", text: "Missing required: message (string)" }], isError: true };
      }
      const topic = broker.topic(topicName);
      const id = topic.publish({ sender: opts.botName, payload: message });
      return { content: [{ type: "text", text: `Published message ${id} to topic "${topicName}"` }] };
    }

    case "bus_queue_push": {
      const queueName = args.queue;
      const message = args.message;
      if (typeof queueName !== "string" || !queueName) {
        return { content: [{ type: "text", text: "Missing required: queue (string)" }], isError: true };
      }
      if (typeof message !== "string" || !message) {
        return { content: [{ type: "text", text: "Missing required: message (string)" }], isError: true };
      }
      const queue = broker.queue(queueName);
      const id = queue.push({ sender: opts.botName, payload: message });
      return { content: [{ type: "text", text: `Pushed message ${id} to queue "${queueName}"` }] };
    }

    case "bus_queue_claim": {
      const queueName = args.queue;
      if (typeof queueName !== "string" || !queueName) {
        return { content: [{ type: "text", text: "Missing required: queue (string)" }], isError: true };
      }
      const queue = broker.queue(queueName);
      const item = queue.claim(opts.botName);
      if (!item) {
        return { content: [{ type: "text", text: "No items available in queue" }] };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            messageId: item.message.id,
            sender: item.message.sender,
            payload: item.message.payload,
            attempts: item.attempts,
          }),
        }],
      };
    }

    case "bus_queue_ack": {
      const queueName = args.queue;
      const messageId = args.messageId;
      if (typeof queueName !== "string" || !queueName) {
        return { content: [{ type: "text", text: "Missing required: queue (string)" }], isError: true };
      }
      if (typeof messageId !== "string" || !messageId) {
        return { content: [{ type: "text", text: "Missing required: messageId (string)" }], isError: true };
      }
      const queue = broker.queue(queueName);
      const acked = queue.ack(messageId);
      if (!acked) {
        return { content: [{ type: "text", text: `Message "${messageId}" not found in inflight` }], isError: true };
      }
      return { content: [{ type: "text", text: `Acknowledged message "${messageId}"` }] };
    }

    case "bus_queue_nack": {
      const queueName = args.queue;
      const messageId = args.messageId;
      if (typeof queueName !== "string" || !queueName) {
        return { content: [{ type: "text", text: "Missing required: queue (string)" }], isError: true };
      }
      if (typeof messageId !== "string" || !messageId) {
        return { content: [{ type: "text", text: "Missing required: messageId (string)" }], isError: true };
      }
      const queue = broker.queue(queueName);
      const nacked = queue.nack(messageId);
      if (!nacked) {
        return { content: [{ type: "text", text: `Message "${messageId}" not found in inflight` }], isError: true };
      }
      return { content: [{ type: "text", text: `Returned message "${messageId}" for retry` }] };
    }

    case "bus_poll": {
      const topicName = args.topic;
      if (typeof topicName !== "string" || !topicName) {
        return { content: [{ type: "text", text: "Missing required: topic (string)" }], isError: true };
      }
      const limit = typeof args.limit === "number" ? args.limit : 10;
      const topic = broker.topic(topicName);
      const messages = topic.poll(opts.botName, limit);
      if (messages.length === 0) {
        return { content: [{ type: "text", text: "No new messages" }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(messages) }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown bus tool: ${name}` }], isError: true };
  }
}

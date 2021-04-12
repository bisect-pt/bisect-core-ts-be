import amqp from "amqplib";
import { logger } from "@bisect/bisect-core-ts";

export type ChannelErrorCallback = () => void;

export async function setupChannel(
  brokerUrl: string,
  onChannelErrorCallback?: ChannelErrorCallback
) {
  if (!brokerUrl) {
    const message = "AMQP broker URL not specified";
    logger.error(message);
    throw new Error(message);
  }

  logger.info(`[AMQP] connecting to ${brokerUrl}`);

  const connection = await amqp.connect(brokerUrl);
  const channel = await connection.createChannel();

  const callCallback = (err: any) => {
    logger.error(`[AMQP] connection error: ${err}`);
    if (onChannelErrorCallback) {
      onChannelErrorCallback();
    }
  };

  const onConnectionError = (err: Error) => {
    callCallback(`[AMQP] connection error: ${err}`);
  };

  const onConnectionClosed = () => callCallback("[AMQP] connection closed");

  const onChannelError = (err: Error) => {
    callCallback(`[AMQP] channel error: ${err}`);
  };

  const onChannelClosed = () => callCallback("[AMQP] channel closed");

  connection.on("error", onConnectionError);
  connection.on("close", onConnectionClosed);
  channel.on("error", onChannelError);
  channel.on("close", onChannelClosed);

  const close = () => {
    connection.off("error", onConnectionError);
    connection.off("close", onConnectionClosed);
    channel.off("error", onChannelError);
    channel.off("close", onChannelClosed);
    channel.close();
    connection.close();
  };

  return { channel, close };
}

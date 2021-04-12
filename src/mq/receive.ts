import * as EventEmitter from "events";
import { logger } from "@bisect/bisect-core-ts";
import { setupChannel, ChannelErrorCallback } from "./common";
import { ConsumeMessage } from "amqplib";
import * as types from "./types";

type RawMessage = {
  msg: Buffer;
  ack: () => void;
};

type RawMessageCallback = (m: RawMessage) => void;

type BaseReceiverType = { close: () => void };

/* 
    onMessageCallback: ack MUST be called to confirm that the message has been processed.
*/
const doCreateQueueReceiver = async (
  brokerUrl: string,
  queue: types.IQueueInfo,
  onMessageCallback: RawMessageCallback,
  onChannelErrorCallback: ChannelErrorCallback
): Promise<BaseReceiverType> => {
  const { channel, close } = await setupChannel(
    brokerUrl,
    onChannelErrorCallback
  );

  await channel.assertQueue(queue.name, queue.options);

  channel.prefetch(1);
  logger.info(` [*] Waiting for messages in ${queue.name}`);

  const onMessage = (m: ConsumeMessage | null) => {
    if (!m) return;

    onMessageCallback({
      msg: m.content,
      ack: () => channel.ack(m),
    });
  };

  await channel.consume(queue.name, onMessage, {
    noAck: false,
  });

  return {
    close: close,
  };
};

/* 
    onMessageCallback: ack MUST be called to confirm that the message has been processed.
*/
const doCreateExchangeReceiver = async (
  brokerUrl: string,
  exchangeInfo: types.IExchangeInfo,
  topics: string[],
  onMessageCallback: RawMessageCallback,
  onChannelErrorCallback: ChannelErrorCallback
): Promise<BaseReceiverType> => {
  const { channel, close } = await setupChannel(
    brokerUrl,
    onChannelErrorCallback
  );

  await channel.assertExchange(
    exchangeInfo.name,
    exchangeInfo.type,
    exchangeInfo.options
  );

  const queueName = ""; // unnamed queue
  const queueOptions = { exclusive: true }; // unnamed queue
  const q = await channel.assertQueue(queueName, queueOptions);

  topics.forEach(
    async (key) => await channel.bindQueue(q.queue, exchangeInfo.name, key)
  );

  channel.prefetch(1);
  logger.info(` [*] Waiting for messages in exchange ${exchangeInfo.name}`);

  const onMessage = (m: ConsumeMessage | null) => {
    if (!m) return;

    onMessageCallback({
      msg: m.content,
      ack: () => channel.ack(m),
    });
  };

  await channel.consume(q.queue, onMessage, {
    noAck: false,
  });

  return {
    close: close,
  };
};

function createGenericReceiver<
  ReceiverType extends BaseReceiverType,
  CreatorType extends (
    m: RawMessageCallback,
    e: ChannelErrorCallback
  ) => Promise<ReceiverType>
>(creator: CreatorType) {
  const emitter = new EventEmitter.EventEmitter();
  const onMessage = (m: RawMessage) => {
    emitter.emit(onMessageKey, m.msg);
    m.ack();
  };

  let receiver: ReceiverType | null = null;

  const healthChecker = async () => {
    if (receiver !== null || creatingNow) {
      return;
    }

    logger.info("Health checker: trying to create receiver");
    try {
      creatingNow = true;
      receiver = await creator(onMessage, onChannelError);
    } catch (err) {
      logger.error(`Error connecting to AMQP broker: ${err}`);
      receiver = null;
    } finally {
      creatingNow = false;
    }
  };

  let healthCheckerTimerId: NodeJS.Timeout | null = null;
  const healthCheckInterval = 1000;
  let creatingNow = false;

  const startHealthChecker = () => {
    if (healthCheckerTimerId !== null) {
      return;
    }

    healthCheckerTimerId = setInterval(healthChecker, healthCheckInterval);
  };

  const onChannelError = () => {
    logger.error("Channel error");
    receiver = null;
  };

  const doClose = () => {
    if (healthCheckerTimerId) {
      clearInterval(healthCheckerTimerId);
    }
    healthCheckerTimerId = null;
    if (receiver) {
      receiver.close();
    }
  };

  startHealthChecker();

  return {
    emitter,
    close: doClose,
  };
}

export const createQueueReceiver = (
  brokerUrl: string,
  queue: types.IQueueInfo
) => {
  const creator = async (
    onMessage: RawMessageCallback,
    onChannelError: ChannelErrorCallback
  ) => doCreateQueueReceiver(brokerUrl, queue, onMessage, onChannelError);

  return createGenericReceiver(creator);
};

export const createExchangeReceiver = (
  brokerUrl: string,
  exchangeInfo: types.IExchangeInfo,
  topics: string[]
) => {
  const creator = async (
    onMessage: RawMessageCallback,
    onChannelError: ChannelErrorCallback
  ) =>
    doCreateExchangeReceiver(
      brokerUrl,
      exchangeInfo,
      topics,
      onMessage,
      onChannelError
    );

  return createGenericReceiver(creator);
};

export const onMessageKey = "onMessage";

import { logger } from '@bisect/bisect-core-ts';
import * as types from './types';
import { setupChannel } from './common';

interface IQueuePipe {
    type: 'queue';
    send: (m: types.AnyQueueMessage) => void;
    close: () => void;
}

interface IExchangePipe {
    type: 'exchange';
    send: (m: types.ExchangeMessage) => void;
    close: () => void;
}

type TargetTypes = types.IQueueInfo | types.IExchangeInfo;
type PipeCreator<TargetType, PipeType> = (brokerUrl: string, queue: TargetType) => Promise<PipeType>;

type GenericSenderType<MessageType> = {
    send: (m: MessageType) => void;
    close: () => void;
};

const isErrnoExceptionWithMessage = (e: unknown): e is NodeJS.ErrnoException => {
    if ((e as NodeJS.ErrnoException).message !== undefined) {
        return false;
    }
    return true;
};

const createQueuePipe = async (brokerUrl: string, queue: types.IQueueInfo): Promise<IQueuePipe> => {
    const { channel, close } = await setupChannel(brokerUrl);

    await channel.assertQueue(queue.name, queue.options);

    const send = (m: types.AnyQueueMessage) => {
        const { msg, persistent } = m;
        channel.sendToQueue(queue.name, Buffer.from(JSON.stringify(msg)), {
            persistent: persistent,
        });
    };

    return {
        type: 'queue',
        send,
        close,
    };
};

const createExchangePipe = async (brokerUrl: string, exchange: types.IExchangeInfo): Promise<IExchangePipe> => {
    const { channel, close } = await setupChannel(brokerUrl);

    channel.assertExchange(exchange.name, exchange.type, exchange.options);

    const send = (m: types.ExchangeMessage): void => {
        const { key, msg } = m;
        channel.publish(exchange.name, key, Buffer.from(JSON.stringify(msg)));
    };

    return {
        type: 'exchange',
        send,
        close,
    };
};

class GenericSender<MessageType, SenderType extends GenericSenderType<MessageType>, TargetType> {
    private sender: SenderType | null = null;
    constructor(private readonly pipeCreator: PipeCreator<TargetType, SenderType>) {}

    public async send(brokerUrl: string, target: TargetType, content: MessageType): Promise<boolean> {
        try {
            if (!this.sender) {
                this.sender = await this.pipeCreator(brokerUrl, target);
            }

            if (this.sender) {
                this.sender.send(content);
            }

            return true;
        } catch (err) {
            if (isErrnoExceptionWithMessage(err)) {
                logger.error(`Error sending to target: ${err.message}`);

                this.sender = null;
            } else {
                logger.error(`Error sending to target: ${err}`);

                this.sender = null;
            }
        }

        return false;
    }

    public close() {
        this.sender?.close();
    }
}

function createGenericSender<
    MessageType,
    SenderType extends GenericSenderType<MessageType>,
    TargetType extends TargetTypes
>(pipeCreator: PipeCreator<TargetType, SenderType>, brokerUrl: string, target: TargetType) {
    const sender = new GenericSender<MessageType, SenderType, TargetType>(pipeCreator);
    const outputQueue: MessageType[] = [];
    const isDurable: boolean = target.options?.durable === true;

    const retrySend = async () => {
        logger.info(`Retrying to send. Output queue size: ${outputQueue.length}`);

        while (outputQueue.length > 0) {
            const content = outputQueue.shift();

            if (content) {
                if (!(await sender.send(brokerUrl, target, content))) {
                    outputQueue.unshift(content);
                    return;
                }
            }
        }

        stopRetryTimer();
    };

    let retryTimerId: NodeJS.Timeout | null = null;
    const retryInterval = 1000;

    const startRetryTimer = () => {
        if (retryTimerId !== null) {
            return;
        }

        logger.info('Starting retry timer');

        retryTimerId = setInterval(retrySend, retryInterval);
    };

    const stopRetryTimer = () => {
        if (retryTimerId === null) {
            return;
        }

        logger.info('Stopping retry timer');

        clearInterval(retryTimerId);
        retryTimerId = null;
    };

    const isQueueFull = () => {
        return outputQueue.length > types.MAX_OUTSTANDING_MESSAGES;
    };

    const send = async (content: MessageType) => {
        if (outputQueue.length > 0) {
            if (isQueueFull()) {
                const message = 'Error sending message. Discarded.';
                logger.error(message);
                throw new Error(message);
            } else {
                outputQueue.push(content);
            }
            return;
        }

        if (await sender.send(brokerUrl, target, content)) {
            return;
        }

        // Failed to send. Try to save the message, if required
        if (isDurable && !isQueueFull()) {
            outputQueue.push(content);
            logger.error('Error sending message. Saving in memory.');

            startRetryTimer();
        } else {
            logger.error('Error sending message. Discarded.');
        }
    };

    return {
        send,
        close: () => {
            // TODO: close does not make sure that all messages are sent.
            stopRetryTimer();
            if (sender) {
                sender.close();
            }
        },
    };
}

export const createExchangeSender = (brokerUrl: string, exchange: types.IExchangeInfo) =>
    createGenericSender<types.ExchangeMessage, IExchangePipe, types.IExchangeInfo>(
        createExchangePipe,
        brokerUrl,
        exchange
    );
export const createQueueSender = (brokerUrl: string, queue: types.IQueueInfo) =>
    createGenericSender<types.AnyQueueMessage, IQueuePipe, types.IQueueInfo>(createQueuePipe, brokerUrl, queue);

export const persistent = true;
export const notPersistent = false;

import { Options } from 'amqplib/properties';

// TODO: allow to set a policy to limit the delayed send queue to some size
export const MAX_OUTSTANDING_MESSAGES = 100;

export interface IQueueInfo {
    name: string;
    options: Options.AssertQueue;
}

export interface IExchangeInfo {
    name: string;
    type: 'direct' | 'topic' | 'headers' | 'fanout' | 'match', 
    options: Options.AssertExchange;
    keys: string[];
}

export interface QueueMessage<Content> {
    msg: Content;
    persistent: boolean;
}

export type AnyQueueMessage = QueueMessage<any>;

export interface ExchangeMessage {
    key: string;
    msg: any;
}

export type IMQSender<MessageType> = (content: QueueMessage<MessageType>) => Promise<void>;

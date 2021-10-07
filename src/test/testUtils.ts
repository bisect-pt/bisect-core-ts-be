import { green, white, bgRed, red } from 'colors/safe';
import cliProgress from 'cli-progress';
import ConsoleProxy, { IConsoleMessage, ConsoleStream } from './consoleProxy';
import fs from 'fs';
import util from 'util';
import path from 'path';
import { DateTime } from 'luxon';
import { once } from 'events';
import * as stream from 'stream';

const finished = util.promisify(stream.finished); // (A)

async function writeIterableToFile(iterable: string[], filePath: string) {
    const writable = fs.createWriteStream(filePath, { encoding: 'utf8' });
    for await (const chunk of iterable) {
        if (!writable.write(chunk)) {
            // (B)
            // Handle backpressure
            await once(writable, 'drain');
        }
    }
    writable.end(); // (C)
    // Wait until done. Throws if there are errors.
    await finished(writable);
}
const mkdir = util.promisify(fs.mkdir);

function dumpMessages(messages: IConsoleMessage[]): void {
    messages.forEach((message) => {
        switch (message.stream) {
            case ConsoleStream.stdout:
                {
                    process.stdout.write(green(message.message));
                    process.stdout.write('\n');
                }
                break;

            case ConsoleStream.stderr: {
                process.stdout.write(red(message.message));
                process.stdout.write('\n');
            }
        }
    });
}

export type TestRequirements = string[];

export interface ITestSettings {
    readonly address: string;
    readonly username: string;
    readonly password: string;
    readonly enabledRequirements: TestRequirements;
}

export interface ITestContext {
    readonly settings: ITestSettings;

    // Writes a string to a file on a folder created for this test run.
    // The path to the file will be relative to that folder,
    // and will contain the components specified in the path argument.
    // The folders will be created under '/tmp/bisect-tests/<date and time>/<test name>/
    // The string will be written in 'UTF-8'.
    // Returns the path to the file.
    //
    // E.g.
    // const path = await context.writeToFile('output/expected.json', JSON.stringify(data));
    //
    // Will create a 'output' directory with a 'expected.json' file and return the path to that file.
    writeToFile(path: string, content: string): Promise<string>;
}

export type TestFunction = (context: ITestContext) => Promise<void>;

interface ITestEntry {
    readonly name: string;
    readonly test: TestFunction;
    readonly requirements: TestRequirements;
}

enum TestResult {
    success,
    failure,
}

interface ITestSuccess {
    readonly kind: TestResult.success;
    name: string;
}

interface ITestFailure {
    readonly kind: TestResult.failure;
    readonly name: string;
    readonly result: any;
    readonly console: IConsoleMessage[];
}

type ITestResult = ITestSuccess | ITestFailure;

function isSuccess(result: ITestResult): result is ITestSuccess {
    return (result as ITestSuccess).kind === TestResult.success;
}

const didTestFail = (result: ITestResult): boolean => result.kind === TestResult.failure;

const padName = (name: string) => {
    const maxLength = 50;
    const n = name.length > maxLength ? name.substring(0, maxLength) : name;
    return n.padEnd(maxLength);
};

const printSucceeded = (result: ITestSuccess) => {
    process.stdout.write(`${padName(result.name)}: `);
    process.stdout.write(green('[OK]'));
    process.stdout.write('\n');
};

const printFailed = (result: ITestFailure) => {
    process.stdout.write(`${padName(result.name)}: `);
    process.stdout.write(white(bgRed('[Failed]')));
    process.stdout.write(' ');
    process.stdout.write(result.result.toString());
    process.stdout.write('\n');
    dumpMessages(result.console);
};

const printResult = (result: ITestResult) => {
    if (isSuccess(result)) {
        printSucceeded(result);
    } else {
        printFailed(result);
    }
};

const runTest = async (
    t: ITestEntry,
    settings: ITestSettings,
    onTestSucceeded: (result: ITestSuccess) => void,
    onTestFailed: (result: ITestFailure) => void,
    testOutputBasePath: string
): Promise<ITestResult> => {
    const logger = new ConsoleProxy();
    logger.activate();

    try {
        const writeToFile = async (filePath: string, content: string): Promise<string> => {
            const outPath = path.join(testOutputBasePath, filePath);
            const fileDir = path.dirname(outPath);
            await mkdir(fileDir, {
                recursive: true,
            });

            await writeIterableToFile([content], outPath);

            return outPath;
        };

        const context: ITestContext = { settings: settings, writeToFile: writeToFile };
        await t.test(context);
        const result: ITestSuccess = { kind: TestResult.success, name: t.name };
        onTestSucceeded(result);
        return result;
    } catch (err) {
        const result: ITestFailure = {
            kind: TestResult.failure,
            name: t.name,
            result: err,
            console: logger.messages,
        };
        onTestFailed(result);
        return result;
    } finally {
        logger.deactivate();
    }
};

const runAll = async (
    tests: Array<ITestEntry>,
    settings: ITestSettings,
    onTestSucceeded: (result: ITestSuccess) => void,
    onTestFailed: (result: ITestFailure) => void,
    testOutputBasePath: string
): Promise<Array<ITestResult>> => {
    const results: Array<ITestResult> = [];

    for (var i = 0; i < tests.length; i++) {
        const test = tests[i];
        const basePath = path.join(testOutputBasePath, test.name);

        const result = await runTest(test, settings, onTestSucceeded, onTestFailed, basePath);
        results.push(result);
    }
    return results;
};

function formatter(options: cliProgress.Options, params: cliProgress.Params, payload: any) {
    const additionalChars = 60;
    const barMin = 20;
    const barMax = params.maxWidth - additionalChars;
    const barSize = Math.max(barMin, barMax);
    const size = (barSize * params.value) / params.total;
    const bar = '█'.repeat(size);
    const padding = '█'.repeat(barSize - size);
    const color = payload.failed === 0 ? green : red;
    const failed = payload.failed ? ` | Failed: ${payload.failed}` : '';

    return `Test progress [${color(bar)}${padding}] | ${params.value}/${params.total} tests${failed}`;
}

const printSummary = (results: Array<ITestResult>) => {
    process.stdout.write('\n\nSummary:\n\n');
    results.forEach((r) => printResult(r));
    process.stdout.write('\n');

    const failed: number = results.filter((r) => didTestFail(r)).length;

    if (failed) {
        process.stdout.write(red(`${failed} tests failed.`));
    }

    process.stdout.write('\n\n');
};

export const waitFor = (milliseconds: number): Promise<void> => {
    return new Promise((resolve: () => void) => {
        setTimeout(() => resolve(), milliseconds);
    });
};

function filterTests(tests: ITestEntry[], enabledRequirements: TestRequirements): ITestEntry[] {
    return tests.filter(
        (test) => !test.requirements.some((requirement: string) => !enabledRequirements.includes(requirement))
    );
}
export class TestRepository {
    private tests = Array<ITestEntry>();

    public addTest(name: string, test: TestFunction, requirements: TestRequirements): void {
        this.tests.push({ name, test, requirements });
    }

    public async run(settings: ITestSettings): Promise<boolean> {
        const filteredTests = filterTests(this.tests, settings.enabledRequirements);

        const bar1 = new cliProgress.SingleBar({
            format: formatter,
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        bar1.start(filteredTests.length, 0, {
            failed: 0,
        });

        let failedCount = 0;

        const onTestSucceeded = () => {
            bar1.increment();
        };

        const onTestFailed = () => {
            failedCount += 1;
            bar1.increment();
            bar1.update({ failed: failedCount });
        };

        const now = DateTime.now().toString();
        const testOutputBasePath = path.join(`/tmp/bisect-tests/${now}`);
        const results: Array<ITestResult> = await runAll(
            filteredTests,
            settings,
            onTestSucceeded,
            onTestFailed,
            testOutputBasePath
        );
        bar1.stop();
        printSummary(results);

        const anyTestFailed: boolean = results.some((r) => didTestFail(r));
        return !anyTestFailed;
    }
}

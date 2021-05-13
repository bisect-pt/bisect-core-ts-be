import { promises as fs, MakeDirectoryOptions, RmDirOptions } from 'fs';

export async function unlinkIfExists(path: string): Promise<void> {
    try {
        await fs.unlink(path);
    } catch (e) {
        if (e.code === 'ENOENT') {
            // The file does not exist. OK.
            return;
        }

        console.log(`Error deleting file: ${JSON.stringify(e)}`);
        throw e;
    }
}

export async function recreateDirectory(path: string): Promise<void> {
    try {
        const rmOptions: RmDirOptions = {
            recursive: true,
        };
        await fs.rmdir(path, rmOptions);
    } catch (e) {
        if (e.code !== 'ENOENT') {
            // The error is not file does not exist.
            console.log(`Error deleting directory: ${JSON.stringify(e)}`);
            throw e;
        }
    }

    try {
        const options: MakeDirectoryOptions & { recursive: true } = {
            recursive: true,
            mode: 0o777,
        };
        await fs.mkdir(path, options);
    } catch (e) {
        console.log(`Error creating directory: ${JSON.stringify(e)}`);
        throw e;
    }
}

export async function createDirectoryIfNeeded(path: string): Promise<void> {
    try {
        const options: MakeDirectoryOptions = {
            recursive: true,
            mode: 0o777,
        };
        await fs.mkdir(path, options);
    } catch (e) {
        console.log(`Error creating directory: ${JSON.stringify(e)}`);
        throw e;
    }
}

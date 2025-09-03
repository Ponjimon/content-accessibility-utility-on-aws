import { Context } from 'aws-lambda';
interface StatusCheckerEvent {
    jobId?: string;
    outputS3Bucket: string;
    outputS3Prefix?: string;
}
interface StatusCheckerResponse {
    jobId: string;
    status: 'COMPLETED' | 'IN_PROGRESS' | 'FAILED';
    outputLocation: string;
    filesFound?: string[];
    error?: string;
}
export declare const handler: (event: StatusCheckerEvent, context: Context) => Promise<StatusCheckerResponse>;
export {};

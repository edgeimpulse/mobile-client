import { Sample } from "../models";

export interface ISamplingOptions {
    mode?: 'raw' | 'jpeg';
    length?: number;
    frequency?: number;
    inputWidth?: number;
    inputHeight?: number;
    inputChannels?: number;
    processing?: () => void;
    continuousMode?: boolean;
}

export interface ISensor {
    getProperties(): {
        name: string,
        maxSampleLength: number,
        frequencies: number[]
    };
    hasSensor(): Promise<boolean>;
    checkPermissions(fromClick: boolean): Promise<boolean>;
    takeSample(samplingOptions: ISamplingOptions): Promise<Sample>;
}

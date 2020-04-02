import { Sample } from "../models";

export interface ISensor {
    getProperties(): {
        name: string,
        maxSampleLength: number,
        frequencies: number[]
    };
    hasSensor(): boolean;
    checkPermissions(fromClick: boolean): Promise<boolean>;
    takeSample(lengthMs: number, frequency: number, processing: () => void): Promise<Sample>;
}

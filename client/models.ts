export interface EdgeImpulseSettings {
    apiKey: string;
    device: DeviceSettings;
}

export interface DeviceSettings {
    deviceId: string;
    deviceType: string;
    sensors: {
        name: string;
        frequencies: number[];
        maxSampleLength: number;
    }[];
}

export type Measurement = number[];
export type Measurements = Measurement[];
export type Sample = {
    values: number[][] | number[] | string[];
    intervalMs: number;
    sensors: { name: string, units: string }[];
    attachments?: { value: Blob | null, options: { contentType: string}}[];
}

export interface SampleDetails {
    label: string;
    length: number;
    path: string;
    hmacKey: string;
    interval: number;
    sensor: string;
    attachments?: { value: Blob | null, options: { contentType: string}}[];
}

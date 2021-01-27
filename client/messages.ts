import {
    EdgeImpulseSettings,
    Measurements,
    Sample
} from "./models";

const emptySignature = Array(64)
    .fill("0")
    .join("");

export const dataMessage = (
    settings: EdgeImpulseSettings,
    sample: Sample
) => {
    return {
        protected: {
            ver: "v1",
            alg: "HS256",
            iat: Math.floor(Date.now() / 1000) // epoch time, seconds since 1970
        },
        signature: emptySignature,
        payload: {
            device_name: settings.device.deviceId,
            device_type: settings.device.deviceType,
            interval_ms: sample.intervalMs,
            sensors: sample.sensors,
            values: sample.values
        }
    };
};

export const helloMessage = (settings: EdgeImpulseSettings) => {
    return {
        hello: {
            version: 3,
            apiKey: settings.apiKey,
            deviceId: settings.device.deviceId,
            deviceType: settings.device.deviceType,
            connection: "ip",
            sensors: settings.device.sensors.map(s => {
                return {
                    name: s.name,
                    maxSampleLengthS: s.maxSampleLength,
                    frequencies: s.frequencies
                }
            }),
            supportsSnapshotStreaming: false
        }
    };
};

export const sampleRequestReceived = {
    sample: true
};

export const sampleRequestFailed = (error: string) => {
    return {
        sample: false,
        error
    };
};

export const sampleStarted = {
    sampleStarted: true
};

export const sampleProcessing = {
    sampleProcessing: true
};

export const sampleUploading = {
    sampleUploading: true
};

export const sampleFinished = {
    sampleFinished: true
};

import { ISensor, ISamplingOptions } from "./isensor";
import { Sample } from "../models";

declare class Recorder {
    constructor(mediaStream: MediaStreamAudioSourceNode, options: {
        numChannels: number;
    });

    record(): void;
    recording: boolean;
    clear(): void;
    stop(): void;
    exportWAV(fn: (blob: Blob) => any, mimeType: string | undefined, frequency: number): void;
}

export class MicrophoneSensor implements ISensor {
    private _audioContext: AudioContext | undefined;
    private _constraints = {
        audio: true,
        video: false
    };
    private _stream: MediaStream | undefined;
    private _recorder: Recorder | undefined;

    constructor() {
        if (this.hasSensor()) {
            this._audioContext = new (window.AudioContext || (<any>window).webkitAudioContext)();
        }
    }

    async hasSensor() {
        return typeof window.AudioContext !== 'undefined' || typeof (<any>window).webkitAudioContext !== 'undefined';
    }

    async checkPermissions(fromButton: boolean) {
        if (!this.hasSensor()) {
            throw new Error('Accelerometer not present on this device');
        }

        if (this._recorder) {
            return true;
        }

        if (!fromButton) {
            return false;
        }

        if (this._audioContext?.state === "suspended") {
            // Resume after user interaction
            // https://developers.google.com/web/updates/2017/09/autoplay-policy-changes#webaudio
            await this._audioContext.resume();
        }

        this._stream = await navigator.mediaDevices.getUserMedia(this._constraints);

        return true;
    }

    getProperties() {
        return {
            name: 'Microphone',
            maxSampleLength: 1 * 60,
            frequencies: [ 16000, 8000, 11000, 32000, 44100, 48000 ]
        };
    }

    takeSample(samplingOptions: ISamplingOptions) {
        return new Promise<Sample>((resolve, reject) => {
            if (!this._stream) {
                return reject('No audio stream');
            }
            if (!samplingOptions.frequency) {
                throw new Error('Frequency not specified')
            }
            if (!samplingOptions.length) {
                throw new Error('Frequency not specified')
            }
            let length = samplingOptions.length;
            let frequency = samplingOptions.frequency;

            if (!this._audioContext) {
                return reject('No audio context');
            }

            // use the stream
            let input = this._audioContext.createMediaStreamSource(this._stream);

            // Create the Recorder object and configure to record mono sound (1 channel)
            // Recording 2 channels will double the file size
            if (!this._recorder) {
                this._recorder = new Recorder(input, {
                    numChannels: 1
                });
                this._recorder.record();
            }
            else {
                this._recorder.clear();
            }

            setTimeout(() => {
                if (!this._stream) return;

                // tell the recorder to stop the recording
                // this._stream.getAudioTracks()[0].stop();

                if (samplingOptions.processing) {
                    samplingOptions.processing();
                }

                if (!this._recorder) return;

                // create the wav blob and pass it on to createDownloadLink
                this._recorder.exportWAV(async (blob) => {
                    let buffer = await new Response(blob).arrayBuffer();
                    console.log('done recording', buffer.byteLength);
                    let wavFileItems = new Int16Array(buffer, 44);
                    let eiData = [];
                    for (let w of wavFileItems) {
                        eiData.push(w);
                    }

                    // this._stream = undefined;

                    resolve({
                        values: eiData.slice(0, length * (frequency / 1000)),
                        intervalMs: 1000 / frequency,
                        sensors: [{
                                name: "audio",
                                units: "wav"
                            }
                        ],
                    });
                }, undefined, frequency);
            }, samplingOptions.continuousMode ? length : length + 100);
        });
    }
}

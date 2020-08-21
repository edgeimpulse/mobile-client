import { ISensor, ISamplingOptions } from "./isensor";
import { Sample } from "../models";

const MAX_IMAGE_WIDTH = 640;

export class CameraSensor implements ISensor {

    private _stream: MediaStream | undefined
    constructor() {
        /* noop */
    }

    async hasSensor() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            return false;
        }
        let devices = await navigator.mediaDevices.enumerateDevices();
        return devices.some(device => 'videoinput' === device.kind);
    }

    async checkPermissions(fromClick: boolean): Promise<boolean> {
        if (!this.hasSensor()) {
            throw new Error('Camera not present on this device');
        }
        if (this._stream) {
            return true;
        }
        if (fromClick) {
            this._stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    width: { ideal: 512 },
                    height: { ideal: 512 },
                    facingMode: {
                        ideal: 'environment'
                    }
                }
            });
            const video = document.querySelector('video');
            if (!video) {
                throw new Error('Element not found');
            }
            video.srcObject = this._stream;
            return true;
        }
        return false;
    }

    getProperties() {
        return {
            name: 'Camera',
            maxSampleLength: 100,
            frequencies: []
        };
    }

    takeSample(samplingOptions: ISamplingOptions) {
        const video = document.querySelector('video');
        const canvas = document.querySelector('canvas');
        const capture = document.querySelector('#capture-camera') as HTMLElement;
        const captureButton = document.querySelector('#capture-camera-button') as HTMLElement;

        if (!video || !canvas || !capture || !captureButton) {
            throw new Error('Element not found');
        }
        if (!this._stream) {
            throw new Error('Video stream not set');
        }
        let streamWidth = this._stream.getVideoTracks()[0].getSettings().width || 256;
        let streamHeight = this._stream.getVideoTracks()[0].getSettings().height || 256;
        let imageWidth = samplingOptions.inputWidth || Math.min(streamWidth, MAX_IMAGE_WIDTH);
        let imageHeight = samplingOptions.inputHeight || (imageWidth / streamWidth) * streamHeight;

        canvas.width = imageWidth;
        canvas.height = imageHeight;

        return new Promise<Sample>((resolve, reject) => {
            captureButton.onclick = () => {
                captureButton.classList.add('disabled');

                this.takeSnapshot(samplingOptions).then(resolve).catch(reject);
            };
        }).then((v) => {
            captureButton.classList.remove('disabled');
            return v;
        }).catch((err) => {
            captureButton.classList.remove('disabled');
            throw err;
        });
    }

    takeSnapshot(samplingOptions: ISamplingOptions) {
        // @todo: this needs to be moved out to proper elements!
        const video = document.querySelector('video');
        const canvas = document.querySelector('canvas');

        if (!video || !canvas) {
            throw new Error('Element not found');
        }

        if (!this._stream) {
            throw new Error('Video stream not set');
        }

        let streamWidth = this._stream.getVideoTracks()[0].getSettings().width || 256;
        let streamHeight = this._stream.getVideoTracks()[0].getSettings().height || 256;
        let imageWidth = samplingOptions.inputWidth || Math.min(streamWidth, MAX_IMAGE_WIDTH);
        let imageHeight = samplingOptions.inputHeight || (imageWidth / streamWidth) * streamHeight;

        canvas.width = imageWidth;
        canvas.height = imageHeight;

        return new Promise<Sample>((resolve, reject) => {
            const saveFrame = (blob: Blob | null) => {
                if (!blob) {
                    return reject('Sampling failed');
                }

                resolve({
                    values: ['Ref-BINARY-image/jpeg (' + blob.size.toString() + ' bytes) xyz'],
                    intervalMs: 0,
                    sensors: [{
                        name: "image",
                        units: "rgba"
                    }],
                    attachments: [{
                        value: blob,
                        options: {
                            contentType: 'image/jpeg'
                        }
                    }]
                });
            };

            const context = canvas.getContext('2d');
            if (!context) {
                throw new Error("Canvas not supported");
            }

            context.drawImage(video, 0, 0, imageWidth, imageHeight);
            if (samplingOptions.mode === 'raw') {
                let imageData = context.getImageData(0, 0, imageWidth, imageHeight);
                let values = [];
                for (let ix = 0; ix < imageWidth * imageHeight; ix++) {
                    // tslint:disable-next-line: no-bitwise
                    values.push(Number((imageData.data[ix * 4] << 16)
                        // tslint:disable-next-line: no-bitwise
                        | (imageData.data[ix * 4 + 1] << 8)
                        // tslint:disable-next-line: no-bitwise
                        | (imageData.data[ix * 4 + 2])))
                }

                resolve({
                    values: values,
                    intervalMs: 0,
                    sensors: [{
                        name: "image",
                        units: "rgba"
                    }]
                });
            } else {
                canvas.toBlob(saveFrame, 'image/jpeg', 0.95);
            }
        });
    }
}

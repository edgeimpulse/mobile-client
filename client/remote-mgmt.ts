import {
    sampleRequestReceived, sampleFinished, sampleUploading, dataMessage,
    helloMessage, sampleRequestFailed, sampleStarted
} from "./messages";
import { parseMessage, createSignature } from "./utils";
import { EdgeImpulseSettings, SampleDetails, Sample } from "./models";
import { getRemoteManagementEndpoint, getIngestionApi } from "./settings";
import { AxiosStatic } from '../node_modules/axios';
import { Emitter } from "./typed-event-emitter";
import { ISensor } from "./sensors/isensor";

declare var axios: AxiosStatic;

interface RemoteManagementConnectionState {
    socketConnected: boolean;
    remoteManagementConnected: boolean;
    error: string | null;
    sample: SampleDetails | null;
    isSampling: boolean;
}

export class RemoteManagementConnection extends Emitter<{
    connected: [],
    error: [string],
    samplingStarted: [number],
    samplingUploading: [],
    samplingFinished: [],
    samplingProcessing: [],
    samplingError: [string]
}> {
    private _socket: WebSocket;
    private _socketHeartbeat = -1;
    private _state: RemoteManagementConnectionState;
    private _settings: EdgeImpulseSettings;

    constructor(settings: EdgeImpulseSettings,
                waitForSamplingToStart?: (sensorName: string) => Promise<ISensor>) {
        super();

        this._socket = new WebSocket(getRemoteManagementEndpoint());
        this._state = {
            socketConnected: false,
            remoteManagementConnected: false,
            error: null,
            sample: null,
            isSampling: false
        };
        this._settings = settings;

        this._socket.onopen = _e => {
            this._state.socketConnected = true;
            this.sendMessage(helloMessage(this._settings));
            this._socketHeartbeat = window.setInterval(() => {
                this._socket.send("ping");
            }, 3000);
        };

        this._socket.onmessage = async event => {
            const data = await parseMessage(event);
            if (!data) {
                return;
            }

            // ping messages are not understood, so skip those
            if (data.err !== undefined && data.err.indexOf('Failed to parse') === -1) {
                this.emit('error', data.err);
            }

            if (data.hello !== undefined) {
                const msg = data.hello;
                this._state.remoteManagementConnected = msg.hello;
                this._state.error = msg.error;
                if (this._state.error) {
                    this.emit('error', this._state.error);
                }
                else {
                    this.emit('connected');
                }
            }

            if (data.sample !== undefined) {
                const msg = data.sample as SampleDetails;
                if (!msg || !msg.hmacKey) {
                    this.sendMessage(sampleRequestFailed("Message or hmacKey empty"));
                    return;
                }

                if (!waitForSamplingToStart) return;

                try {
                    this.sendMessage(sampleRequestReceived);

                    let sensor = await waitForSamplingToStart(msg.sensor);

                    // Start to sample
                    this._state.sample = msg;
                    this._state.isSampling = true;
                    this.sendMessage(sampleStarted);
                    const sampleDetails = {
                        ...msg
                    };

                    this.emit('samplingStarted', msg.length);

                    const sampleData = await sensor.takeSample({
                        length: msg.length,
                        frequency: 1000 / msg.interval,
                        processing: () => {
                            this.emit('samplingProcessing');
                        }
                    });

                    // Upload sample
                    await this.uploadSample(
                        sampleDetails,
                        dataMessage(this._settings, sampleData),
                        sampleData
                    );
                    this._state.sample = msg;
                    this._state.isSampling = false;
                }
                catch (ex) {
                    this.emit('samplingFinished');
                    this.emit('samplingError', ex.message || ex.toString());
                    this.sendMessage(
                        sampleRequestFailed((ex.message || ex.toString()))
                    );
                }
            }
        };

        this._socket.onclose = event => {
            clearInterval(this._socketHeartbeat);
            const msg = event.wasClean ?
                `[close] Connection closed cleanly, code=${event.code} reason=${event.reason}` : // e.g. server process killed or network down
                // event.code is usually 1006 in this case
                "[close] Connection died";
            this._state.socketConnected = false;
            this._state.remoteManagementConnected = false;
            this._state.error = msg;
            this.emit('error', this._state.error);
        };

        this._socket.onerror = error => {
            this._state.socketConnected = false;
            this._state.remoteManagementConnected = false;
            this._state.error = (error as unknown) as string;
            this.emit('error', this._state.error);
        };
    }

    sendMessage = (data: any) => {
        this._socket.send(JSON.stringify(data));
    };

    readAsBinaryStringAsync(file: Blob) {
        return new Promise((resolve, reject) => {
            let reader = new FileReader();
            reader.onload = () => {
                resolve(reader.result);
            };
            reader.onerror = reject;
            reader.readAsBinaryString(file);
        })
    }

    private async uploadSample(
        details: SampleDetails,
        data: ReturnType < typeof dataMessage >,
        sampleData: Sample
    ) {
        try {
            this.emit('samplingUploading');

            data.signature = await createSignature(details.hmacKey, data);

            let formData = new FormData();
            formData.append("message", new Blob([ (JSON.stringify(data))],
                { type: "application/json"}), "message.json");
            if (sampleData.attachments && sampleData.attachments[0].value) {
                formData.append("image", sampleData.attachments[0].value, "image.jpg");
            }

            this.sendMessage(sampleUploading);

            return new Promise((resolve: any, reject: any) => {

                let xml = new XMLHttpRequest();
                xml.onload = () => resolve();
                xml.onerror = () => reject();
                xml.open("post", getIngestionApi() + details.path)
                xml.setRequestHeader("x-api-key", this._settings.apiKey)
                xml.setRequestHeader("x-file-name", details.label)
                xml.send(formData);

                this.sendMessage(sampleFinished);
                this.emit('samplingFinished');
            })

        } catch (e) {
            alert(JSON.stringify(e));
        }
    }
}

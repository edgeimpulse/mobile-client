/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Emitter } from "./typed-event-emitter";
import { EdgeImpulseClassifier } from "./classifier";
import { getErrorMsg } from './utils';
import { WasmRuntimeModule } from './classifier';
import { ApiAuth } from "./settings";

declare global {
    interface Window {
        WasmLoader: (wasmUrl: string) => WasmRuntimeModule;
        blb: Blob;
        wasmFeatureDetect: {
            simd: () => Promise<boolean>;
        };
    }
}

const SOCKETIO_EVENT_CODE = '42'; // 4: message, 2: event
export class ClassificationLoader extends Emitter<{ status: [string]; buildProgress: [string | null] }> {
    private _studioHost: string;
    private _wsHost: string;
    private _auth: ApiAuth;
    private _project: { id: number, owner: string, name: string, studioUrl: string } | undefined;
    private _impulseIdQs: string;
    private _variant: 'float32' | 'int8' = 'float32';

    constructor(studioHostUrl: string, auth: ApiAuth) {
        super();
        this._studioHost = studioHostUrl + '/v1/api';
        this._wsHost = studioHostUrl.replace('http', 'ws');
        this._auth = auth;
        this._impulseIdQs = typeof this._auth.impulseId === 'number' ?
            `impulseId=${encodeURIComponent(this._auth.impulseId)}` :
            '';
    }

    getProjectInfo() {
        return this._project;
    }

    async load() {
        this.emit('status', 'Retrieving projects...');

        const project = await this.getProject();
        if (!project) {
            throw new Error('Could not find any projects');
        }
        this._project = project;

        const projectId = project.id;

        let deployType: 'wasm' | 'wasm-browser-simd';
        if (await window.wasmFeatureDetect.simd()) {
            deployType = 'wasm-browser-simd';
        }
        else {
            deployType = 'wasm';
        }

        const variants = await this.getModelVariants(projectId);
        let variant = variants.modelVariants.find(x => x.isReferenceVariant);
        if (!variant) {
            if (variants.modelVariants.length > 0) {
                variant = variants.modelVariants[0];
            }
            else {
                throw new Error(`Could not find any model variants for this project: ` +
                    JSON.stringify(variants));
            }
        }
        this._variant = variant.variant;
        console.log('Model variant is:', this._variant);

        let blob: Blob;
        this.emit('status', 'Downloading deployment...');

        try {
            blob = await this.downloadDeployment(projectId, deployType);
        }
        catch (ex) {
            let m = getErrorMsg(ex);
            if (m.indexOf('No deployment yet') === -1) {
                throw ex;
            }

            this.emit('status', 'Building project...');

            await this.buildDeployment(projectId, deployType);

            this.emit('status', 'Downloading deployment...');

            blob = await this.downloadDeployment(projectId, deployType);
        }

        console.log('blob', blob);

        this.emit('status', 'Received blob (' + Math.floor(blob.size / 1024) + ' KB), extracting...');

        const data = await this.unzip(blob);

        this.emit('status', 'Extracted ' + data.length + ' files');

        console.log('Extracted files', data);

        let wasmFile = data.find(d => d.filename.endsWith('edge-impulse-standalone.wasm'));
        if (!wasmFile) {
            wasmFile = data.find(d => d.filename.endsWith('.wasm'));
            if (!wasmFile) {
                throw new Error('Cannot find edge-impulse-standalone.wasm file in ZIP file');
            }
        }

        let jsFile = data.find(d => d.filename.endsWith('edge-impulse-standalone.js'));
        if (!jsFile) {
            jsFile = data.find(d => d.filename.endsWith('.js'));
            if (!jsFile) {
                throw new Error('Cannot find edge-impulse-standalone.js file in ZIP file');
            }
        }

        const wasmUrl = await this.blobToDataUrl(wasmFile.blob);
        this.emit('status', 'WASM URL is ' + wasmUrl.substr(0, 100) + '...');

        let loaderText = await this.blobToText(jsFile.blob);
        loaderText = 'window.WasmLoader = function (wasmBinaryFile) {\n' +
            loaderText + '\n' +
            'return Module;\n' +
            '}';

        loaderText = loaderText.replace('var wasmBinaryFile="edge-impulse-standalone.wasm"', '');
        loaderText = loaderText.replace(`var wasmBinaryFile;\n  wasmBinaryFile = 'edge-impulse-standalone.wasm';`, '');

        const loaderBlob = new Blob([ loaderText ], { type: 'text/javascript' });

        const script = document.createElement('script');
        script.src = URL.createObjectURL(loaderBlob);

        console.log('adding script with src', script.src);

        window.document.body.append(script);

        // wait until script is loaded...
        await new Promise<void>((resolve, reject) => {
            script.addEventListener('load', () => resolve());
            script.addEventListener('error', reject);
        });

        const module = window.WasmLoader(wasmUrl);
        this.emit('status', 'Loaded WASM module');

        const classifier = new EdgeImpulseClassifier(module);
        await classifier.init();

        this.emit('status', 'Initialized classifier');
        return classifier;
    }

    async getProject(): Promise<{
        id: number;
        owner: string;
        name: string;
        studioUrl: string;
    }> {
        if (this._auth.auth === 'apiKey') {
            return new Promise((resolve, reject) => {
                const x = new XMLHttpRequest();
                x.open('GET', `${this._studioHost}/projects`);
                x.onload = () => {
                    if (x.status !== 200) {
                        reject('No projects found: ' + x.status + ' - ' + JSON.stringify(x.response));
                    }
                    else {
                        if (!x.response.success) {
                            reject(x.response.error);
                        }
                        else {
                            resolve(x.response.projects[0]);
                        }
                    }
                };
                x.onerror = err => reject(err);
                x.responseType = 'json';
                if (this._auth.auth === 'apiKey') {
                    x.setRequestHeader('x-api-key', this._auth.apiKey);
                }
                x.send();
            });
        }
        else {
            const projectId = this._auth.projectId;

            return new Promise((resolve, reject) => {
                const x = new XMLHttpRequest();
                x.open('GET', `${this._studioHost}/${projectId}/public-info`);
                x.onload = () => {
                    if (x.status !== 200) {
                        reject('No projects found: ' + x.status + ' - ' + JSON.stringify(x.response));
                    }
                    else {
                        if (!x.response.success) {
                            reject(x.response.error);
                        }
                        else {
                            resolve({
                                id: x.response.id,
                                name: x.response.name,
                                owner: x.response.owner,
                                studioUrl: x.response.studioUrl
                            });
                        }
                    }
                };
                x.onerror = err => reject(err);
                x.responseType = 'json';
                x.send();
            });
        }
    }

    async getDevelopmentKeys(projectId: number): Promise<{
        apiKey: string;
        hmacKey: string;
    }> {
        return new Promise((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open('GET', `${this._studioHost}/${projectId}/devkeys`);
            x.onload = () => {
                if (x.status !== 200) {
                    reject('No development keys found: ' + x.status + ' - ' + JSON.stringify(x.response));
                }
                else {
                    if (!x.response.success) {
                        reject(x.response.error);
                    }
                    else {
                        resolve({
                            apiKey: x.response.apiKey,
                            hmacKey: x.response.hmacKey
                        });
                    }
                }
            };
            x.onerror = err => reject(err);
            x.responseType = 'json';
            if (this._auth.auth === 'apiKey') {
                x.setRequestHeader('x-api-key', this._auth.apiKey);
            }
            x.send();
        });
    }

    private async downloadDeployment(projectId: number, deployType: 'wasm' | 'wasm-browser-simd'): Promise<Blob> {
        return new Promise((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open('GET', `${this._studioHost}/${projectId}/deployment/download?type=${deployType}&modelType=${this._variant}&${this._impulseIdQs}`);
            x.onload = () => {
                if (x.status !== 200) {
                    const reader = new FileReader();
                    reader.onload = () => {
                        reject('No deployment yet');
                    };
                    reader.readAsText(x.response);
                }
                else {
                    resolve(x.response);
                }
            };
            x.onerror = err => reject(err);
            x.responseType = 'blob';
            if (this._auth.auth === 'apiKey') {
                x.setRequestHeader('x-api-key', this._auth.apiKey);
            }
            x.send();
        });
    }

    private async buildDeployment(projectId: number, deployType: 'wasm' | 'wasm-browser-simd') {
        if (this._auth.auth !== 'apiKey') {
            throw new Error('Cannot build deployment if not authenticated via API key');
        }

        let ws = await this.getWebsocket(projectId);

        // select f32 models for all keras blocks
        let impulseRes = await fetch(`${this._studioHost}/${projectId}/impulse?${this._impulseIdQs}`, {
            method: 'GET',
            headers: {
                "x-api-key": this._auth.apiKey,
                "Content-Type": "application/json"
            }
        });
        if (!impulseRes.ok) {
            throw new Error('Failed to start deployment: ' + impulseRes.status + ' - ' + impulseRes.statusText);
        }

        let jobRes = await fetch(`${this._studioHost}/${projectId}/jobs/build-ondevice-model?type=${deployType}&${this._impulseIdQs}`, {
            method: "POST",
            headers: {
                "x-api-key": this._auth.apiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                engine: 'tflite',
                modelType: this._variant,
            })
        });
        if (!jobRes.ok) {
            throw new Error('Failed to start deployment: ' + jobRes.status + ' - ' + jobRes.statusText);
        }

        let jobData: { success: true; id: number } | { success: false; error: string } = await jobRes.json();
        if (!jobData.success) {
            throw new Error(jobData.error);
        }

        let jobId = jobData.id;
        console.log('Created job with ID', jobId);

        ws.send(SOCKETIO_EVENT_CODE + JSON.stringify([ 'start-log-stream', { jobId, lastReceivedTimestamp: 0 }]));

        let allData: string[] = [];

        let p = new Promise<void>((resolve2, reject2) => {
            let pingIv = setInterval(() => {
                ws.send('2');
            }, 25000);

            let checkJobStatusIv = setInterval(async () => {
                try {
                    if (this._auth.auth !== 'apiKey') {
                        throw new Error('Cannot build deployment if not authenticated via API key');
                    }

                    let jobStatus = await fetch(`${this._studioHost}/${projectId}/jobs/${jobId}/status`, {
                        method: "GET",
                        headers: {
                            "x-api-key": this._auth.apiKey,
                            "Content-Type": "application/json"
                        }
                    });
                    if (!jobStatus.ok) {
                        throw new Error('Failed to start deployment: ' + jobStatus.status + ' - ' +
                            jobStatus.statusText);
                    }

                    let status: {
                        success: true;
                        id: number;
                        job: {
                            id: number;
                            key: string;
                            created?: Date;
                            started?: Date;
                            finished?: Date;
                            finishedSuccessful?: boolean;
                        };
                    } | { success: false; error: string } = await jobStatus.json();

                    if (!status.success) {
                        throw new Error(status.error);
                    }
                    if (status.job.finished) {
                        if (status.job.finishedSuccessful) {
                            clearInterval(checkJobStatusIv);
                            resolve2();
                        }
                        else {
                            clearInterval(checkJobStatusIv);
                            reject2('Failed to build binary');
                        }
                    }
                }
                catch (ex2) {
                    let ex = <Error>ex2;
                    console.warn('Failed to check job status', ex.message || ex.toString());
                }
            }, 3000);

            ws.onmessage = (msg) => {
                let data = <string>msg.data;
                try {
                    let m = <any[]>JSON.parse(data.replace(/^[0-9]+/, ''));
                    if (m[0] === 'job-data-' + jobId) {
                        this.emit('buildProgress', m[1].data);
                        allData.push(<string>(<any>m[1]).data);
                    }
                    else if (m[0] === 'job-finished-' + jobId) {
                        let success = (<any>m[1]).success;
                        this.emit('buildProgress', null);
                        // console.log(BUILD_PREFIX, 'job finished', success);
                        if (success) {
                            clearInterval(checkJobStatusIv);
                            resolve2();
                        }
                        else {
                            clearInterval(checkJobStatusIv);
                            reject2('Failed to build binary');
                        }
                    }
                }
                catch (ex) {
                    // console.log(BUILD_PREFIX, 'Failed to parse', data);
                }
            };

            ws.onclose = async () => {
                clearInterval(pingIv);
                reject2('Websocket was closed');
            };
        });

        p.then(() => {
            ws.close();
        }).catch((err) => {
            ws.close();
        });

        return p;
    }

    private async getWebsocket(projectId: number): Promise<WebSocket> {
        let headers: { [k: string]: string } = {
            "Content-Type": "application/json"
        };
        if (this._auth.auth === 'apiKey') {
            headers["x-api-key"] = this._auth.apiKey;
        }

        let tokenRes = await fetch(`${this._studioHost}/${projectId}/socket-token`, {
            method: "GET",
            headers: headers,
        });
        if (tokenRes.status !== 200) {
            throw new Error('Failed to acquire socket token: ' + tokenRes.status + ' - ' + tokenRes.statusText);
        }

        let tokenData: {
            success: true;
            token: {
                socketToken: string;
                expires: Date;
            };
        } | { success: false; error: string } = await tokenRes.json();

        if (!tokenData.success) {
            throw new Error(tokenData.error);
        }

        let ws = new WebSocket(this._wsHost + '/socket.io/?token=' +
            tokenData.token.socketToken + '&EIO=3&transport=websocket&onDemandLogs=true');

        return new Promise((resolve, reject) => {
            ws.onopen = () => {
                console.log('websocket is open');
            };
            ws.onclose = () => {
                reject('websocket was closed');
            };
            ws.onerror = err => {
                reject('websocket error: ' + err);
            };
            ws.onmessage = msg => {
                try {
                    let m = JSON.parse(msg.data.replace(/^[0-9]+/, ''));
                    if (m[0] === 'hello') {
                        if (m[1].hello && m[1].hello.version === 1) {
                            resolve(ws);
                        }
                        else {
                            reject(JSON.stringify(m[1]));
                        }
                    }
                }
                catch (ex) {
                    console.log('Failed to parse', msg.data);
                }
            };

            setTimeout(() => {
                reject('Did not authenticate with the websocket API within 10 seconds');
            }, 10000);
        });
    }

    private async unzip(blob: Blob): Promise<{ filename: string; blob: Blob } []> {
        const ret: { filename: string; blob: Blob } [] = [];

        return new Promise((resolve, reject) => {
            window.blb = blob;

            (<any>window).zip.createReader(new (<any>window).zip.BlobReader(blob), (reader: any) => {
                reader.getEntries((entries: any) => {
                    for (const e of entries) {
                        e.getData(new (<any>window).zip.BlobWriter(), (file: Blob) => {
                            ret.push({
                                filename: e.filename,
                                blob: file
                            });
                            if (ret.length === entries.length) {
                                return resolve(ret);
                            }
                        });
                    }
                });
            }, (error: Error) => {
                reject(error);
            });
        });
    }

    private async getModelVariants(projectId: number): Promise<{
        modelVariants: {
            variant: 'float32' | 'int8',
            isReferenceVariant: boolean,
            isEnabled: boolean,
            isSelected: boolean,
        }[],
    }> {
        return new Promise((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open('GET', `${this._studioHost}/${projectId}/model-variants?${this._impulseIdQs}`);
            x.onload = () => {
                if (x.status !== 200) {
                    reject('/model-variants returned: ' + x.status + ' - ' + JSON.stringify(x.response));
                }
                else {
                    if (!x.response.success) {
                        reject(x.response.error);
                    }
                    else {
                        resolve({
                            modelVariants: x.response.modelVariants,
                        });
                    }
                }
            };
            x.onerror = err => reject(err);
            x.responseType = 'json';
            if (this._auth.auth === 'apiKey') {
                x.setRequestHeader('x-api-key', this._auth.apiKey);
            }
            x.send();
        });
    }

    private async blobToDataUrl(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const a = new FileReader();
            a.onload = e => resolve(((e.target && e.target.result) || '').toString());
            a.onerror = err => reject(err);
            a.readAsDataURL(blob);
        });
    }

    private async blobToText(blob: Blob): Promise<string> {
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.addEventListener('loadend', (e) => {
                const text = reader.result;
                resolve((text || '').toString());
            });
            reader.readAsText(blob, 'ascii');
        });
    }

    private async sleep(ms: number) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }
}
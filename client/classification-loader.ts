import { Emitter } from "./typed-event-emitter";
import { EdgeImpulseClassifier } from "./classifier";
import { AxiosStatic } from '../node_modules/axios';

declare var axios: AxiosStatic;

export class ClassificationLoader extends Emitter<{ status: [string]; buildProgress: [string | null]; }> {
    private _studioHost: string;
    private _wsHost: string;
    private _apiKey: string;

    constructor(studioHostUrl: string, apiKey: string) {
        super();
        this._studioHost = studioHostUrl + '/v1/api';
        this._wsHost = studioHostUrl.replace('http', 'ws');
        this._apiKey = apiKey;
    }

    async load() {
        this.emit('status', 'Retrieving projects...');

        const project = await this.getProject();
        if (!project) {
            throw new Error('Could not find any projects');
        }

        const projectId = project.id;

        let blob: Blob;
        this.emit('status', 'Downloading deployment...');

        try {
            blob = await this.downloadDeployment(projectId);
        }
        catch (ex) {
            let m = typeof ex === 'string' ? ex : (ex.message || ex.toString());
            if (m.indexOf('No deployment yet') === -1) {
                throw ex;
            }

            this.emit('status', 'Building project...');

            await this.buildDeployment(projectId);

            this.emit('status', 'Downloading deployment...');

            blob = await this.downloadDeployment(projectId);
        }

        console.log('blob', blob);

        this.emit('status', 'Received blob (' + Math.floor(blob.size / 1024) + ' KB), extracting...');

        const data = await this.unzip(blob);

        this.emit('status', 'Extracted ' + data.length + ' files');

        const wasmFile = data.find(d => d.filename.endsWith('.wasm'));
        if (!wasmFile) {
            throw new Error('Cannot find .wasm file in ZIP file');
        }

        const jsFile = data.find(d => d.filename.endsWith('.js'));
        if (!jsFile) {
            throw new Error('Cannot find .js file in ZIP file');
        }

        const wasmUrl = await this.blobToDataUrl(wasmFile.blob);
        this.emit('status', 'WASM URL is ' + wasmUrl.substr(0, 100) + '...');

        let loaderText = await this.blobToText(jsFile.blob);
        loaderText = 'window.WasmLoader = function (wasmBinaryFile) {\n' +
            loaderText + '\n' +
            'return Module;\n' +
            '}';
        loaderText = loaderText.replace('var wasmBinaryFile="edge-impulse-standalone.wasm"', '');

        console.log('loaderText', loaderText);

        const script = document.createElement('script');
        script.innerHTML = loaderText;
        window.document.body.append(script);

        const module = (window as any).WasmLoader(wasmUrl);
        this.emit('status', 'Loaded WASM module');

        const classifier = new EdgeImpulseClassifier(module);
        await classifier.init();

        this.emit('status', 'Initialized classifier');
        return classifier;
    }


    async getProject(): Promise < {
        id: number;
        name: string;
    } > {
        return new Promise((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open('GET', `${this._studioHost}/projects`);
            x.onload = () => {
                if (x.status !== 200) {
                    reject('No projects found: ' + x.status + ' - ' + JSON.stringify(x.response));
                } else {
                    if (!x.response.success) {
                        reject(x.response.error);
                    } else {
                        resolve(x.response.projects[0]);
                    }
                }
            };
            x.onerror = err => reject(err);
            x.responseType = 'json';
            x.setRequestHeader('x-api-key', this._apiKey);
            x.send();
        });
    }

    async getDevelopmentKeys(projectId: number): Promise <{
        apiKey: string,
        hmacKey: string
    }> {
        return new Promise((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open('GET', `${this._studioHost}/${projectId}/devkeys`);
            x.onload = () => {
                if (x.status !== 200) {
                    reject('No development keys found: ' + x.status + ' - ' + JSON.stringify(x.response));
                } else {
                    if (!x.response.success) {
                        reject(x.response.error);
                    } else {
                        resolve({
                            apiKey: x.response.apiKey,
                            hmacKey: x.response.hmacKey
                        });
                    }
                }
            };
            x.onerror = err => reject(err);
            x.responseType = 'json';
            x.setRequestHeader('x-api-key', this._apiKey);
            x.send();
        });
    }

    private async downloadDeployment(projectId: number): Promise < Blob > {
        return new Promise((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open('GET', `${this._studioHost}/${projectId}/deployment/download?type=wasm&modelType=float32`);
            x.onload = () => {
                if (x.status !== 200) {
                    const reader = new FileReader();
                    reader.onload = () => {
                        reject('No deployment yet');
                    };
                    reader.readAsText(x.response);
                } else {
                    resolve(x.response);
                }
            };
            x.onerror = err => reject(err);
            x.responseType = 'blob';
            x.setRequestHeader('x-api-key', this._apiKey);
            x.send();
        });
    }

    private async buildDeployment(projectId: number) {
        let ws = await this.getWebsocket(projectId);

        // select f32 models for all keras blocks
        let impulseRes = await axios({
            url: `${this._studioHost}/${projectId}/impulse`,
            method: 'GET',
            headers: {
                "x-api-key": this._apiKey,
                "Content-Type": "application/json"
            }
        });
        if (impulseRes.status !== 200) {
            throw new Error('Failed to start deployment: ' + impulseRes.status + ' - ' + impulseRes.statusText);
        }

        let jobRes = await axios({
            url: `${this._studioHost}/${projectId}/jobs/build-ondevice-model?type=wasm`,
            method: "POST",
            headers: {
                "x-api-key": this._apiKey,
                "Content-Type": "application/json"
            },
            data: {
                engine: 'tflite',
                modelType: 'float32'
            }
        });
        if (jobRes.status !== 200) {
            throw new Error('Failed to start deployment: ' + jobRes.status + ' - ' + jobRes.statusText);
        }

        let jobData: { success: true, id: number } | { success: false, error: string } = jobRes.data;
        if (!jobData.success) {
            throw new Error(jobData.error);
        }

        let jobId = jobData.id;
        console.log('Created job with ID', jobId);

        let allData: string[] = [];

        let p = new Promise<void>((resolve2, reject2) => {
            let pingIv = setInterval(() => {
                ws.send('2');
            }, 25000);

            let checkJobStatusIv = setInterval(async () => {
                try {
                    let jobStatus = await axios({
                        url: `${this._studioHost}/${projectId}/jobs/${jobId}/status`,
                        method: "GET",
                        headers: {
                            "x-api-key": this._apiKey,
                            "Content-Type": "application/json"
                        }
                    });
                    if (jobStatus.status !== 200) {
                        throw new Error('Failed to start deployment: ' + jobStatus.status + ' - ' +
                            jobStatus.statusText);
                    }

                    let status: {
                        success: true,
                        id: number,
                        job: {
                            id: number,
                            key: string,
                            created?: Date,
                            started?: Date,
                            finished?: Date,
                            finishedSuccessful?: boolean
                        }
                    } | { success: false, error: string } = jobStatus.data;

                    if (!status.success) {
                        // tslint:disable-next-line: no-unsafe-any
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
                        // tslint:disable-next-line: no-unsafe-any
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

            setTimeout(() => {
                reject2('Building did not succeed within 5 minutes: ' + allData.join(''));
            }, 300000);
        });

        p.then(() => {
            ws.close();
        }).catch((err) => {
            ws.close();
        });

        return p;
    }

    private async getWebsocket(projectId: number): Promise<WebSocket> {
        let tokenRes = await axios({
            url: `${this._studioHost}/${projectId}/socket-token`,
            method: "GET",
            headers: {
                "x-api-key": this._apiKey,
                "Content-Type": "application/json"
            }
        });
        if (tokenRes.status !== 200) {
            throw new Error('Failed to acquire socket token: ' + tokenRes.status + ' - ' + tokenRes.statusText);
        }

        let tokenData: {
            success: true,
            token: {
                socketToken: string,
                expires: Date
            }
        } | { success: false, error: string } = tokenRes.data;

        if (!tokenData.success) {
            throw new Error(tokenData.error);
        }

        let ws = new WebSocket(this._wsHost + '/socket.io/?token=' +
            tokenData.token.socketToken + '&EIO=3&transport=websocket');

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

    private async unzip(blob: Blob): Promise<{ filename: string; blob: Blob; } []> {
        const ret: { filename: string; blob: Blob; } [] = [];

        return new Promise((resolve, reject) => {
            (<any>window).blb = blob;

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

    private async blobToDataUrl(blob: Blob): Promise < string > {
        return new Promise((resolve, reject) => {
            const a = new FileReader();
            a.onload = e => resolve(((e.target && e.target.result) || '').toString());
            a.onerror = err => reject(err);
            a.readAsDataURL(blob);
        });
    }

    private async blobToText(blob: Blob): Promise < string > {
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
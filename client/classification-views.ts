import { getApiKey, getDeviceId, storeApiKey, storeDeviceId } from "./settings";
import { ISensor } from "./sensors/isensor";
import { AccelerometerSensor } from "./sensors/accelerometer";
import { MicrophoneSensor } from "./sensors/microphone";
import { ClassificationLoader } from "./classification-loader";
import { EdgeImpulseClassifier } from "./classifier";

export class ClassificationClientViews {
    private _views = {
        loading: document.querySelector('#loading-view') as HTMLElement,
        qrcode: document.querySelector('#qrcode-view') as HTMLElement,
        connectionFailed: document.querySelector('#remote-mgmt-failed') as HTMLElement,
        selectSensor: document.querySelector('#permission-view') as HTMLElement,
        inferencing: document.querySelector('#inferencing-in-progress') as HTMLElement
    };

    private _elements = {
        deviceId: document.querySelector('#connected-device-id') as HTMLElement,
        connectionFailedMessage: document.querySelector('#connection-failed-message') as HTMLElement,
        loadingText: document.querySelector('#loading-view-text') as HTMLElement,
        grantPermission: document.querySelector('#grant-permissions-button') as HTMLElement,
        inferencingTimeLeft: document.querySelector('#inferencing-time-left') as HTMLElement,
        inferencingMessage: document.querySelector('#inferencing-recording-data-message') as HTMLElement,
        inferencingResult: document.querySelector('#inferencing-result') as HTMLElement,
        inferencingResultTable: document.querySelector('#inferencing-result table') as HTMLElement,
        buildProgress: document.querySelector('#build-progress') as HTMLElement
    };

    private _sensors: ISensor[] = [];
    private _classifier: EdgeImpulseClassifier | undefined;
    private _firstInference = true;
    private _inferenceCount = 0;

    constructor() {
        storeDeviceId(getDeviceId());

        const accelerometer = new AccelerometerSensor();
        if (accelerometer.hasSensor()) {
            console.log('has accelerometer');
            this._sensors.push(accelerometer);
        }

        const microphone = new MicrophoneSensor();
        if (microphone.hasSensor()) {
            console.log('has microphone');
            this._sensors.push(microphone);
        }

        if (getApiKey()) {
            // persist keys now...
            storeApiKey(getApiKey());

            this._elements.loadingText.textContent = 'Loading classifier...';

            // tslint:disable-next-line: no-floating-promises
            (async () => {
                let loader = new ClassificationLoader('https://studio.edgeimpulse.com', getApiKey());
                loader.on('status', msg => {
                    this._elements.loadingText.textContent = msg;
                });
                loader.on('buildProgress', progress => {
                    if (typeof progress === 'string') {
                        this._elements.buildProgress.style.display = 'block';
                        this._elements.buildProgress.textContent = progress || ' ';
                    }
                    else {
                        this._elements.buildProgress.style.display = 'none';
                    }
                });
                try {
                    this._classifier = await loader.load();

                    let props = this._classifier.getProperties();

                    if (props.sensor === 'microphone' && !microphone.hasSensor()) {
                        throw new Error('Model expects microphone, but device has none');
                    }
                    else if (props.sensor === 'accelerometer' && !accelerometer.hasSensor()) {
                        throw new Error('Model expects accelerometer, but device has none');
                    }

                    if (props.sensor === 'accelerometer') {
                        this._elements.grantPermission.textContent = 'Give access to the accelerometer';
                    }
                    else if (props.sensor === 'microphone') {
                        this._elements.grantPermission.textContent = 'Give access to the microphone';
                    }
                    else {
                        throw new Error('Unexpected sensor: ' + props.sensor);
                    }

                    let sensor = this._sensors.find(s => s.getProperties().name.toLowerCase() === props.sensor);
                    if (sensor && await sensor.checkPermissions(false)) {
                        console.log('sensor checkPermissions OK');
                        this.grantPermission();
                    }
                    else {
                        this.switchView(this._views.selectSensor);
                    }
                }
                catch (ex) {
                    console.error('Failed to load', ex);
                    if ((ex.message || ex.toString()).indexOf('No deployment yet') > -1) {
                        this._elements.connectionFailedMessage.innerHTML = 'No deployment yet. Go to the ' +
                            '<strong>Deployment</strong> page in the Edge Impulse studio, and deploy as WebAssembly.';
                    }
                    else {
                        this._elements.connectionFailedMessage.textContent = (ex.message || ex.toString());
                    }

                    this.switchView(this._views.connectionFailed);
                }
                finally {
                    this._elements.buildProgress.style.display = 'none';
                }
            })();
        }
        else {
            this.switchView(this._views.qrcode);
        }

        this._elements.grantPermission.onclick = this.grantPermission.bind(this);

        window.history.replaceState(null, '', window.location.pathname);
    }

    private switchView(view: HTMLElement) {
        for (const k of Object.keys(this._views)) {
            (<{ [k: string]: HTMLElement }>this._views)[k].style.display = 'none';
        }
        view.style.display = '';
    }

    private grantPermission() {
        if (!this._classifier) return;

        let prop = this._classifier.getProperties();
        let sensor = this._sensors.find(s => s.getProperties().name.toLowerCase() === prop.sensor);
        if (!sensor) {
            this._elements.connectionFailedMessage.textContent = 'Could not find sensor ' + prop.sensor;
            this.switchView(this._views.connectionFailed);
            return;
        }

        sensor.checkPermissions(true).then(result => {
            if (result) {
                this.switchView(this._views.inferencing);

                console.log('prop', prop);

                let sampleWindowLength = prop.frameSampleCount * (1000 / prop.frequency);
                this._elements.inferencingTimeLeft.textContent = 'Waiting';
                this._elements.inferencingMessage.textContent = 'Starting in 2 seconds...';

                const sampleNextWindow = async () => {
                    if (!sensor || !this._classifier) return;

                    this._elements.inferencingMessage.textContent = 'Sampling...';

                    let timeLeft = sampleWindowLength;
                    this._elements.inferencingTimeLeft.textContent = Math.floor(timeLeft / 1000) + 's';
                    let iv = setInterval(() => {
                        timeLeft -= 1000;
                        this._elements.inferencingTimeLeft.textContent = Math.floor(timeLeft / 1000) + 's';
                    }, 1000);

                    try {
                        // clear out so it's clear we're inferencing
                        let data = await sensor.takeSample(sampleWindowLength, prop.frequency, () => { /* noop */ });
                        clearInterval(iv);

                        // give some time to give the idea we're inferencing
                        this._elements.inferencingMessage.textContent = 'Inferencing...';
                        await this.sleep(200);

                        let d: number[];
                        if (data.values[0] instanceof Array) {
                            d = (<number[][]>data.values).reduce((curr, v) => curr.concat(v), []);
                        }
                        else {
                            d = <number[]>data.values;
                        }

                        console.log('raw data', d.length, d);

                        console.time('inferencing');
                        let res = this._classifier.classify(d, true);
                        console.timeEnd('inferencing');

                        this._elements.inferencingResult.style.visibility = '';

                        if (this._firstInference) {
                            this._firstInference = false;

                            let thead = <HTMLElement>this._elements.inferencingResultTable.querySelector('thead tr');
                            for (let e of res.results) {
                                let th = document.createElement('th');
                                th.scope = 'col';
                                th.textContent = e.label;
                                th.classList.add('px-0', 'text-center');
                                thead.appendChild(th);
                            }
                            if (res.anomaly !== 0.0) {
                                let th = document.createElement('th');
                                th.scope = 'col';
                                th.textContent = 'anomaly';
                                th.classList.add('px-0', 'text-center');
                                thead.appendChild(th);
                            }

                            if (thead.lastChild) {
                                (<HTMLElement>thead.lastChild).classList.add('pr-4');
                            }
                        }

                        let tbody = <HTMLElement>this._elements.inferencingResultTable.querySelector('tbody');
                        let row = document.createElement('tr');
                        row.innerHTML = '<td class="pl-4 pr-0">' + (++this._inferenceCount) + '</td>';
                        row.classList.add('active');

                        setTimeout(() => {
                            row.classList.remove('active');
                        }, 1000);

                        for (let e of res.results) {
                            let td = document.createElement('td');
                            td.textContent = e.value.toFixed(2);
                            td.classList.add('px-0', 'text-center');
                            if (Math.max(...res.results.map(v => v.value)) === e.value) {
                                td.classList.add('font-weight-bold');
                            }
                            else {
                                td.classList.add('text-gray');
                            }

                            row.appendChild(td);
                        }

                        if (res.anomaly !== 0.0) {
                            let td = document.createElement('td');
                            td.textContent = res.anomaly.toFixed(2);
                            td.classList.add('px-0', 'text-center');
                            row.appendChild(td);
                        }

                        if (row.lastChild) {
                            (<HTMLElement>row.lastChild).classList.add('pr-4');
                        }

                        if (tbody.childNodes.length === 0) {
                            tbody.appendChild(row);
                        }
                        else {
                            tbody.insertBefore(row, tbody.firstChild);
                        }

                        this._elements.inferencingTimeLeft.textContent = 'Waiting';
                        this._elements.inferencingMessage.textContent = 'Starting in 2 seconds...';
                        setTimeout(sampleNextWindow, 2000);
                    }
                    catch (ex) {
                        clearInterval(iv);
                        this._elements.connectionFailedMessage.textContent = (ex.message || ex.toString());
                        this.switchView(this._views.connectionFailed);
                    }
                };

                setTimeout(sampleNextWindow, 2000);
            }
            else {
                alert('User has rejected ' + (prop.sensor) + ' permissions')
            }
        }).catch(err => {
            this._elements.connectionFailedMessage.textContent = err;
            this.switchView(this._views.connectionFailed);
        });
    }

    private sleep(ms: number) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }
}
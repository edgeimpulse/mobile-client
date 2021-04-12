import { getApiKey, getDeviceId, storeApiKey, storeDeviceId, getStudioEndpoint } from "./settings";
import { ISensor, ISamplingOptions } from "./sensors/isensor";
import { AccelerometerSensor } from "./sensors/accelerometer";
import { MicrophoneSensor } from "./sensors/microphone";
import { CameraSensor } from "./sensors/camera";
import { ClassificationLoader } from "./classification-loader";
import { EdgeImpulseClassifier } from "./classifier";
import { Notify } from "./notify";

export class ClassificationClientViews {
    private _views = {
        loading: document.querySelector('#loading-view') as HTMLElement,
        qrcode: document.querySelector('#qrcode-view') as HTMLElement,
        connectionFailed: document.querySelector('#remote-mgmt-failed') as HTMLElement,
        selectSensor: document.querySelector('#permission-view') as HTMLElement,
        inferencing: document.querySelector('#inferencing-in-progress') as HTMLElement,
    };

    private _elements = {
        deviceId: document.querySelector('#connected-device-id') as HTMLElement,
        connectionFailedMessage: document.querySelector('#connection-failed-message') as HTMLElement,
        loadingText: document.querySelector('#loading-view-text') as HTMLElement,
        grantPermission: document.querySelector('#grant-permissions-button') as HTMLElement,
        inferencingSamplingBody: document.querySelector('#inferencing-sampling-body') as HTMLElement,
        inferencingTimeLeft: document.querySelector('#inferencing-time-left') as HTMLElement,
        inferencingMessage: document.querySelector('#inferencing-recording-data-message') as HTMLElement,
        inferencingResult: document.querySelector('#inferencing-result') as HTMLElement,
        inferencingResultTable: document.querySelector('#inferencing-result table') as HTMLElement,
        buildProgress: document.querySelector('#build-progress') as HTMLElement,
        inferenceCaptureBody: document.querySelector('#capture-camera') as HTMLElement,
        inferenceCaptureButton: document.querySelector('#capture-camera-button') as HTMLElement,
        inferenceRecordingMessageBody: document.querySelector('#inference-recording-message-body') as HTMLElement,
        switchToDataCollection: document.querySelector('#switch-to-data-collection') as HTMLAnchorElement,
        cameraInner: document.querySelector('.capture-camera-inner') as HTMLElement,
        cameraVideo: document.querySelector('.capture-camera-inner video') as HTMLVideoElement,
        cameraCanvas: document.querySelector('.capture-camera-inner canvas') as HTMLCanvasElement,
    }

    private _sensors: ISensor[] = [];
    private _classifier: EdgeImpulseClassifier | undefined;
    private _firstInference = true;
    private _inferenceCount = 0;
    private _isObjectDetection = false;
    private _colors = [
        '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#42d4f4', '#f032e6', '#fabed4',
        '#469990', '#dcbeff', '#9A6324', '#fffac8', '#800000', '#aaffc3',
    ];
    private _labelToColor: { [k: string]: string } = { };

    async init() {
        storeDeviceId(getDeviceId());

        const accelerometer = new AccelerometerSensor();
        if (await accelerometer.hasSensor()) {
            console.log('has accelerometer');
            this._sensors.push(accelerometer);
        }

        const microphone = new MicrophoneSensor();
        if (await microphone.hasSensor()) {
            console.log('has microphone');
            this._sensors.push(microphone);
        }

        const camera = new CameraSensor();
        if (await camera.hasSensor()) {
            console.log('has camera');
            this._sensors.push(camera);
        }

        if (window.location.search.indexOf('from=camera') > -1) {
            this._elements.switchToDataCollection.href = 'camera.html';
        }
        if (window.location.search.indexOf('from=microphone') > -1) {
            this._elements.switchToDataCollection.href = 'microphone.html';
        }

        if (getApiKey()) {
            // persist keys now...
            storeApiKey(getApiKey());
            window.history.replaceState(null, '', window.location.pathname);

            this._elements.loadingText.textContent = 'Loading classifier...';

            // tslint:disable-next-line: no-floating-promises
            (async () => {
                let loader = new ClassificationLoader(getStudioEndpoint(), getApiKey());
                loader.on('status', msg => {
                    console.log('status', msg);
                    this._elements.loadingText.textContent = msg;
                });
                loader.on('buildProgress', progress => {
                    console.log('buildProgress', progress);
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
                    else if (props.sensor === 'camera' && !camera.hasSensor()) {
                        throw new Error('Model expects camera, but device has none');
                    }

                    if (props.sensor === 'accelerometer') {
                        this._elements.grantPermission.textContent = 'Give access to the accelerometer';
                    }
                    else if (props.sensor === 'microphone') {
                        this._elements.grantPermission.textContent = 'Give access to the microphone';
                    }
                    else if (props.sensor === 'camera') {
                        this._elements.grantPermission.textContent = 'Give access to the camera';
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

                if (prop.sensor === 'camera') {
                    this._elements.inferencingSamplingBody.style.display = 'none';
                    this._elements.inferenceCaptureBody.style.display = '';
                    this._elements.inferenceRecordingMessageBody.style.display = 'none';
                }
                else {
                    this._elements.inferencingSamplingBody.style.display = '';
                    this._elements.inferenceCaptureBody.style.display = 'none';
                    this._elements.inferenceRecordingMessageBody.style.display = '';
                }

                let sampleWindowLength = prop.frameSampleCount * (1000 / prop.frequency);
                this._elements.inferencingTimeLeft.textContent = 'Waiting';
                this._elements.inferencingMessage.textContent = 'Starting in 2 seconds...';

                const sampleNextWindow = async () => {
                    if (!sensor || !this._classifier) return;

                    this._elements.inferencingMessage.textContent = 'Sampling...';

                    let iv;
                    if (prop.sensor !== 'camera') {
                        let timeLeft = sampleWindowLength;
                        this._elements.inferencingTimeLeft.textContent = Math.round(timeLeft / 1000) + 's';
                        iv = setInterval(() => {
                            timeLeft -= 1000;
                            this._elements.inferencingTimeLeft.textContent = Math.round(timeLeft / 1000) + 's';
                        }, 1000);
                    }

                    try {
                        // clear out so it's clear we're inferencing
                        let samplingOptions: ISamplingOptions = { };
                        if (prop.sensor === 'camera') {
                            samplingOptions.mode = 'raw';
                            samplingOptions.inputWidth = prop.inputWidth;
                            samplingOptions.inputHeight = prop.inputHeight;
                        } else {
                            samplingOptions.length = sampleWindowLength;
                            samplingOptions.frequency = prop.frequency ;
                        }

                        let data = await sensor.takeSample(samplingOptions);
                        if (iv) {
                            clearInterval(iv);
                        }

                        if (prop.sensor === 'camera') {
                            console.log('classification disable button');
                            this._elements.inferenceCaptureButton.innerHTML = '<i class="fa fa-camera mr-2"></i>Inferencing...';
                            this._elements.inferenceCaptureButton.classList.add('disabled');

                            if (this._isObjectDetection) {
                                for (let bx of Array.from(this._elements.cameraInner.querySelectorAll('.bounding-box-container'))) {
                                    bx.parentNode?.removeChild(bx);
                                }
                                await this.sleep(10);
                            }
                            else {
                                await this.sleep(100);
                            }
                        }
                        else {
                            // give some time to give the idea we're inferencing
                            this._elements.inferencingMessage.textContent = 'Inferencing...';
                            await this.sleep(500);
                        }

                        let d: number[];
                        if (data.values[0] instanceof Array) {
                            d = (<number[][]>data.values).reduce((curr, v) => curr.concat(v), []);
                        }
                        else {
                            d = <number[]>data.values;
                        }

                        // console.log('raw data', d.length, d);

                        console.time('inferencing');
                        let res = this._classifier.classify(d, false);
                        console.timeEnd('inferencing');

                        console.log('inference results', res);

                        if (this._firstInference && res.results.length > 0) {
                            this._firstInference = false;
                            this._isObjectDetection = typeof res.results[0].x === 'number';

                            if (!this._isObjectDetection) {
                                this._elements.inferencingResult.style.visibility = '';

                                let thead = <HTMLElement>
                                    this._elements.inferencingResultTable.querySelector('thead tr');
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
                        }

                        if (!this._isObjectDetection && res.results.length > 0) {
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
                        }
                        else {
                            for (let bx of Array.from(this._elements.cameraInner.querySelectorAll('.bounding-box-container'))) {
                                bx.parentNode?.removeChild(bx);
                            }

                            if (res.results.length === 0) {
                                Notify.notify('', 'No objects found', 'top', 'center',
                                    'fas fa-exclamation-triangle', 'success');
                            }

                            let factor = Number(this._elements.cameraCanvas.height) /
                                Number(this._elements.cameraVideo.clientHeight);

                            for (let b of res.results.filter(bb => bb.value >= 0.5)) {
                                if (typeof b.x !== 'number' ||
                                    typeof b.y !== 'number' ||
                                    typeof b.width !== 'number' ||
                                    typeof b.height !== 'number') {
                                    continue;
                                }
                                let bb = {
                                    x: b.x / factor,
                                    y: b.y / factor,
                                    width: b.width / factor,
                                    height: b.height / factor,
                                    label: b.label,
                                    value: b.value
                                };

                                if (!this._labelToColor[bb.label]) {
                                    this._labelToColor[bb.label] = this._colors[0];
                                    this._colors.splice(0, 1);
                                }

                                let color = this._labelToColor[bb.label];

                                let el = document.createElement('div');
                                el.classList.add('bounding-box-container');
                                el.style.position = 'absolute';
                                el.style.border = 'solid 3px ' + color;
                                el.style.width = (bb.width) + 'px';
                                el.style.height = (bb.height) + 'px';
                                el.style.left = (bb.x) + 'px';
                                el.style.top = (bb.y) + 'px';

                                let label = document.createElement('div');
                                label.classList.add('bounding-box-label');
                                label.style.background = color;
                                label.textContent = bb.label + ' (' + bb.value.toFixed(2) + ')';
                                el.appendChild(label);

                                this._elements.cameraInner.appendChild(el);
                            }
                        }

                        if (prop.sensor === 'camera') {
                            console.log('classification enable button again');
                            this._elements.inferenceCaptureBody.style.display = 'initial'
                            this._elements.inferenceRecordingMessageBody.style.display = 'none'
                            this._elements.inferenceCaptureButton.innerHTML = '<i class="fa fa-camera mr-2"></i>Classify';
                            this._elements.inferenceCaptureButton.classList.remove('disabled');
                            // immediately sample next window
                            setTimeout(sampleNextWindow, 0);
                        }
                        else {
                            let startDelay = 2;
                            this._elements.inferenceCaptureBody.style.display = 'none'
                            this._elements.inferenceRecordingMessageBody.style.display = 'initial'
                            this._elements.inferencingTimeLeft.textContent = 'Waiting';
                            this._elements.inferencingMessage.textContent = `Starting in ${startDelay} seconds...`;
                            setTimeout(sampleNextWindow, startDelay * 1000);
                        }
                    }
                    catch (ex) {
                        clearInterval(iv);
                        console.error(ex);
                        this._elements.connectionFailedMessage.textContent = (ex.message || ex.toString());
                        this.switchView(this._views.connectionFailed);
                    }
                };

                setTimeout(sampleNextWindow, prop.sensor === 'camera' ? 0 : 2000);
            }
            else {
                alert('User has rejected ' + (prop.sensor) + ' permissions')
            }
        }).catch(err => {
            console.error(err);
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
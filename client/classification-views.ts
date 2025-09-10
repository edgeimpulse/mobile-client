import { getAuth, getDeviceId, storeApiKeyAndImpulseId, storeDeviceId, getStudioEndpoint } from "./settings";
import { ISensor, ISamplingOptions } from "./sensors/isensor";
import { AccelerometerSensor } from "./sensors/accelerometer";
import { MicrophoneSensor } from "./sensors/microphone";
import { CameraSensor } from "./sensors/camera";
import { Positional9DOFSensor } from "./sensors/9axisIMU";
import { ClassificationLoader } from "./classification-loader";
import { ClassificationResponse, ClassifierProperties, ClassifierThresholds, EdgeImpulseClassifier } from "./classifier";
import { Notify } from "./notify";
import { getErrorMsg } from "./utils";

export class ClassificationClientViews {
    private _views = {
        loading: document.querySelector('#loading-view') as HTMLElement,
        qrcode: document.querySelector('#qrcode-view') as HTMLElement,
        connectionFailed: document.querySelector('#remote-mgmt-failed') as HTMLElement,
        selectSensor: document.querySelector('#permission-view') as HTMLElement,
        inferencing: document.querySelector('#inferencing-in-progress') as HTMLElement,
    };

    private _elements = {
        title: document.querySelector('h1') as HTMLElement,
        deviceId: document.querySelector('#connected-device-id') as HTMLElement,
        connectionFailedMessage: document.querySelector('#connection-failed-message') as HTMLElement,
        loadingText: document.querySelector('#loading-view-text') as HTMLElement,
        grantPermission: document.querySelector('#grant-permissions-button') as HTMLElement,
        inferencingSamplingBody: document.querySelector('#inferencing-sampling-body') as HTMLElement,
        inferencingTimeLeft: document.querySelector('#inferencing-time-left') as HTMLElement,
        inferencingMessage: document.querySelector('#inferencing-recording-data-message') as HTMLElement,
        inferencingResult: document.querySelector('#inferencing-result') as HTMLElement,
        inferencingResultTable: document.querySelector('#inferencing-result table') as HTMLElement,
        perfCalHint: document.querySelector('#performance-calibration-hint') as HTMLElement,
        buildProgress: document.querySelector('#build-progress') as HTMLElement,
        inferenceCaptureBody: document.querySelector('#capture-camera') as HTMLElement,
        inferenceCaptureButton: document.querySelector('#capture-camera-button') as HTMLElement,
        inferenceRecordingMessageBody: document.querySelector('#inference-recording-message-body') as HTMLElement,
        switchToDataCollection: document.querySelector('#switch-to-data-collection') as HTMLAnchorElement,
        cameraInner: document.querySelector('.capture-camera-inner') as HTMLElement,
        cameraVideo: document.querySelector('.capture-camera-inner video') as HTMLVideoElement,
        cameraCanvas: document.querySelector('.capture-camera-inner canvas') as HTMLCanvasElement,
        timePerInferenceContainer: document.querySelector('#time-per-inference-container') as HTMLElement,
        timePerInference: document.querySelector('#time-per-inference') as HTMLElement,
        shareHint: document.querySelector('#inferencing-public-project-hint') as HTMLElement,
        thresholdsCol: document.querySelector('#thresholds-col') as HTMLElement,
        thresholdsBody: document.querySelector('#thresholds-body') as HTMLElement,
    };

    private _sensors: ISensor[] = [];
    private _classifier: EdgeImpulseClassifier | undefined;
    private _firstInference = true;
    private _inferenceCount = 0;
    private _isObjectDetection = false;
    private _colors = [
        '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#42d4f4', '#f032e6', '#fabed4',
        '#469990', '#dcbeff', '#9A6324', '#fffac8', '#800000', '#aaffc3',
    ];
    private _colorIx = 0;
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

        const imu9DOF = new Positional9DOFSensor();
        if (await imu9DOF.hasSensor()) {
            console.log('has 9-axis positional sensors');
            this._sensors.push(imu9DOF);
        }

        if (window.location.search.indexOf('from=camera') > -1) {
            this._elements.switchToDataCollection.href = 'camera.html';
        }
        if (window.location.search.indexOf('from=microphone') > -1) {
            this._elements.switchToDataCollection.href = 'microphone.html';
        }
        if (window.location.search.indexOf('from=accelerometer') > -1) {
            this._elements.switchToDataCollection.href = 'accelerometer.html';
        }

        const auth = getAuth();

        if (auth) {
            let loader = new ClassificationLoader(getStudioEndpoint(), auth);

            const project = await loader.getProject();

            // set name
            if (project) {
                this._elements.title.textContent = this._elements.title.title =
                    project.owner + ' / ' + project.name;
            }

            // persist keys now...
            if (auth.auth === 'apiKey') {
                storeApiKeyAndImpulseId(auth.apiKey, auth.impulseId);

                // don't rewrite state if auth via public project ID
                window.history.replaceState(null, '', window.location.pathname);

                // no share hint
                this._elements.shareHint.style.display = 'none';
            }
            else {
                // update the link at the bottom to see the public project URL
                if (project) {
                    this._elements.switchToDataCollection.href = project.studioUrl;
                    this._elements.switchToDataCollection.target = '_blank';
                    this._elements.switchToDataCollection.textContent = 'View project on Edge Impulse';
                }

                // switch-to-data-collection
                this._elements.shareHint.style.display = '';
            }

            this._elements.loadingText.textContent = 'Loading classifier...';

            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            (async () => {
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

                    if (props.sensor === 'microphone' && !(await microphone.hasSensor())) {
                        throw new Error('Model expects microphone, but device has none');
                    }
                    else if (props.sensor === 'accelerometer' && !(await accelerometer.hasSensor())) {
                        throw new Error('Model expects accelerometer, but device has none');
                    }
                    else if (props.sensor === 'camera' && !(await camera.hasSensor())) {
                        throw new Error('Model expects camera, but device has none');
                    }
                    else if (props.sensor === 'positional' && !(await imu9DOF.hasSensor())) {
                        throw new Error('Model expects positional sensors, but device has none');
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
                    else if (props.sensor === 'positional') {
                        this._elements.grantPermission.textContent = 'Give access to the motion sensors';
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
                    const errMsg = getErrorMsg(ex);
                    if (errMsg.indexOf('No deployment yet') > -1) {
                        this._elements.connectionFailedMessage.innerHTML = 'No deployment yet. Go to the ' +
                            '<strong>Deployment</strong> page in the Edge Impulse studio, ' +
                            'and deploy as WebAssembly.';
                    }
                    else {
                        this._elements.connectionFailedMessage.textContent = errMsg;
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

        if (view === this._views.inferencing) {
            this._elements.thresholdsCol.style.display = '';
        }
        else {
            this._elements.thresholdsCol.style.display = 'none';
        }
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

                this._elements.timePerInferenceContainer.style.display = 'none';

                let sampleWindowLength = prop.inputFeaturesCount * (1000 / prop.frequency);
                this._elements.inferencingTimeLeft.textContent = 'Waiting';
                this._elements.inferencingMessage.textContent = 'Starting in 2 seconds...';

                if (this._classifier) {
                    this.bindThresholdSettings(this._classifier.getProperties().thresholds);
                }

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
                            samplingOptions.inputWidth = prop.imageInputWidth;
                            samplingOptions.inputHeight = prop.imageInputHeight;
                        }
                        else {
                            samplingOptions.length = sampleWindowLength;
                            samplingOptions.frequency = prop.frequency ;
                        }

                        let data = await sensor.takeSample(samplingOptions);
                        if (iv) {
                            clearInterval(iv);
                        }

                        if (prop.sensor === 'camera') {
                            console.log('classification disable button');
                            this._elements.inferenceCaptureButton.innerHTML =
                                '<i class="fa fa-camera mr-2"></i>Inferencing...';
                            this._elements.inferenceCaptureButton.classList.add('disabled');

                            (<CameraSensor>sensor).pause();

                            if (this._isObjectDetection) {
                                for (let bx of Array.from(
                                    this._elements.cameraInner.querySelectorAll('.bounding-box-container'))
                                ) {
                                    bx.parentNode?.removeChild(bx);
                                }
                                await this.sleep(1);
                            }
                            else {
                                await this.sleep(1);
                            }
                        }
                        else {
                            // give some time to give the idea we're inferencing
                            this._elements.inferencingMessage.textContent = 'Inferencing...';
                            await this.sleep(300);
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

                        await this.renderInferenceResults(res, prop, {
                            showNoObjectsFoundNotification: true,
                        });

                        if (prop.sensor === 'camera') {
                            console.log('classification enable button again');
                            this._elements.inferenceCaptureBody.style.display = 'initial';
                            this._elements.inferenceRecordingMessageBody.style.display = 'none';
                            this._elements.inferenceCaptureButton.classList.remove('disabled');

                            this._elements.inferenceCaptureButton.innerHTML =
                                '<i class="fa fa-camera mr-2"></i>Next photo';

                            let onClick = async (ev: MouseEvent) => {
                                ev.preventDefault();
                                ev.stopImmediatePropagation();

                                this._elements.inferenceCaptureButton.removeEventListener('click', onClick);

                                let cameraSensor = (<CameraSensor>sensor);

                                if (cameraSensor.isPaused()) {
                                    for (let bx of Array.from(
                                        this._elements.cameraInner.querySelectorAll('.bounding-box-container'))) {

                                        bx.parentNode?.removeChild(bx);
                                    }

                                    this._elements.inferenceCaptureButton.innerHTML =
                                        '<i class="fa fa-camera mr-2"></i>Classify';
                                    await cameraSensor.resume();
                                }
                            };

                            this._elements.inferenceCaptureButton.addEventListener('click', onClick);

                            // immediately sample next window
                            setTimeout(sampleNextWindow, 0);
                        }
                        else {
                            let startDelay = 2;
                            this._elements.inferenceCaptureBody.style.display = 'none';
                            this._elements.inferenceRecordingMessageBody.style.display = 'initial';
                            this._elements.inferencingTimeLeft.textContent = 'Waiting';
                            this._elements.inferencingMessage.textContent = `Starting in ${startDelay} seconds...`;
                            setTimeout(sampleNextWindow, startDelay * 1000);
                        }
                    }
                    catch (ex) {
                        clearInterval(iv);
                        console.error(ex);
                        this._elements.connectionFailedMessage.textContent = getErrorMsg(ex);
                        this.switchView(this._views.connectionFailed);
                    }
                };

                if (prop.sensor === 'camera') {
                    return this.sampleImagesContinuous(<CameraSensor>sensor, prop);
                }
                else if (prop.sensor === 'microphone' && sensor) {
                    return this.sampleAudioContinuous(sensor, prop);
                }
                else {
                    setTimeout(sampleNextWindow, 2000);
                }
            }
            else {
                alert('User has rejected ' + (prop.sensor) + ' permissions');
            }
        }).catch(err => {
            console.error(err);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            this._elements.connectionFailedMessage.textContent = err;
            this.switchView(this._views.connectionFailed);
        });
    }

    private sleep(ms: number) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

    private async sampleAudioContinuous(sensor: ISensor, prop: ClassifierProperties) {
        if (!sensor || !this._classifier) return;
        if (prop.sensor !== 'microphone') {
            throw new Error('Sensor is not microphone, cannot do continuous audio sampling');
        }

        const sampleWindowLength = prop.inputFeaturesCount * (1000 / prop.frequency);

        document.body.classList.add('continuous-audio');
        this._elements.inferencingTimeLeft.textContent = 'Listening...';

        let isClassifying = false;
        let last = Date.now();
        let sampleLength: number;
        if (prop.continuousMode) {
            // run in continuous mode? then just use the slice size
            sampleLength = (prop.continuousMode.sliceSize) * (1000 / prop.frequency);
        }
        else {
            // should be 250ms. but if not, make it align to window,
            // e.g. if 800ms. then we use 200ms.
            sampleLength = 250 - (sampleWindowLength % 250);
        }

        let lastFiveResults: string[] = [];

        const classify = async (data: number[]) => {
            try {
                if (!this._classifier) return;
                if (isClassifying) return; // avoid overload on slow devices

                isClassifying = true;

                console.log(Date.now() - last, 'data', data.length);
                last = Date.now();

                console.time('inferencing');
                let res;
                if (prop.continuousMode) {
                    console.log('classifyContinuous');
                    res = this._classifier.classifyContinuous(
                        data.slice(data.length - prop.continuousMode.sliceSize), false, true);
                    }
                    else {
                    console.log('classify');
                    res = this._classifier.classify(data, false);
                }
                console.timeEnd('inferencing');

                console.log('inference results', res);

                await this.renderInferenceResults(res, prop, {
                    activeTimeout: sampleLength,
                    showNoObjectsFoundNotification: true
                });

                // if we have 3 classes (unknown/noise/XXX) then we only show something
                // when XXX is detected...
                let resKeys = res.results.map(x => x.label);
                if (resKeys.length === 3 && resKeys.indexOf('unknown') > -1 &&
                    resKeys.indexOf('noise') > -1) {

                    let keyword = resKeys.find(x => x !== 'noise' && x !== 'unknown');
                    let keywordRes = keyword ? res.results.find(x => x.label === keyword) : undefined;
                    if (keywordRes && keywordRes.value >= 0.8) {
                        lastFiveResults.push(keywordRes.label);
                    }
                    else {
                        lastFiveResults.push('...');
                    }

                    // saw the keyword in the last 5 results? then print it
                    if (lastFiveResults.length > 5) {
                        lastFiveResults = lastFiveResults.slice(1);
                    }

                    if (keywordRes && lastFiveResults.indexOf(keywordRes.label) > -1) {
                        this._elements.inferencingMessage.textContent = keywordRes.label;
                    }
                    else {
                        this._elements.inferencingMessage.textContent = '...';
                    }
                }
                // otherwise just print highest >= classificationThreshold
                else {
                    let highest = res.results.find(x => x.value >= prop.classificationThreshold);
                    if (highest) {
                        this._elements.inferencingMessage.textContent = `${highest.label} (${highest.value.toFixed(2)})`;
                    }
                    else {
                        if (prop.continuousMode) {
                            this._elements.inferencingMessage.textContent = 'No event detected';
                        }
                        else {
                            this._elements.inferencingMessage.textContent = 'uncertain';
                        }
                    }
                }

                isClassifying = false;
            }
            catch (ex2) {
                let ex = <Error>ex2;
                this._elements.connectionFailedMessage.textContent = ex.message || ex.toString();
                this.switchView(this._views.connectionFailed);
            }
        };

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        (async () => {
            try {
                let allData: number[] = [];

                while (1) {
                    let samplingOptions: ISamplingOptions = {
                        length: sampleLength,
                        frequency: prop.frequency,
                        continuousMode: true
                    };
                    let data = await sensor.takeSample(samplingOptions);
                    let d = <number[]>data.values;
                    allData = allData.concat(d);
                    if (allData.length >= prop.inputFeaturesCount) {
                        // we do this in a setTimeout so we go read immediately again
                        setTimeout(() => {
                            // eslint-disable-next-line @typescript-eslint/no-floating-promises
                            classify(allData.slice(allData.length - prop.inputFeaturesCount));
                        }, 0);
                    }
                }
            }
            catch (ex2) {
                let ex = <Error>ex2;
                this._elements.connectionFailedMessage.textContent = ex.message || ex.toString();
                this.switchView(this._views.connectionFailed);
            }
        })();
    }

    private async sampleImagesContinuous(sensor: CameraSensor, prop: ClassifierProperties) {
        if (!this._classifier) return;

        this._elements.timePerInferenceContainer.style.display = '';
        this._elements.timePerInference.textContent = '-';

        while (1) {
            let samplingOptions: ISamplingOptions = {
                mode: 'raw',
                inputWidth: prop.imageInputWidth,
                inputHeight: prop.imageInputHeight,
            };

            this._elements.inferenceCaptureButton.innerHTML =
                '<i class="fa fa-camera mr-2"></i>Inferencing...';
            this._elements.inferenceCaptureButton.classList.add('disabled');

            let data = await sensor.takeSnapshot(samplingOptions);

            await this.sleep(1);

            let d: number[];
            if (data.values[0] instanceof Array) {
                d = (<number[][]>data.values).reduce((curr, v) => curr.concat(v), []);
            }
            else {
                d = <number[]>data.values;
            }

            // console.log('raw data', d.length, d);

            console.time('inferencing');
            let start = Date.now();
            let res = this._classifier.classify(d, false);
            let inferenceTimeMs = Date.now() - start;
            if (inferenceTimeMs === 0) {
                inferenceTimeMs = 1;
            }
            console.timeEnd('inferencing');

            console.log('inference results', res);

            await this.renderInferenceResults(res, prop, {
                showNoObjectsFoundNotification: false,
            });

            this._elements.timePerInference.textContent = inferenceTimeMs.toString();

            console.log('prop.modelType', prop.modelType);

            if (prop.modelType === 'classification') {
                this._elements.inferenceRecordingMessageBody.style.display = '';
                this._elements.inferenceRecordingMessageBody.classList.remove('pt-0');
                this._elements.inferenceRecordingMessageBody.classList.add('pt-4');

                if (prop.hasVisualAnomalyDetection && res.visual_ad_grid_cells.length > 0) {
                    this._elements.inferencingMessage.textContent = 'anomaly';
                }
                else {
                    let highest = res.results.find(x => x.value >= prop.classificationThreshold);
                    if (highest) {
                        this._elements.inferencingMessage.textContent = `${highest.label} (${highest.value.toFixed(2)})`;
                    }
                    else {
                        this._elements.inferencingMessage.textContent = 'uncertain';
                    }
                }
            }
        }
    }

    private async renderInferenceResults(res: ClassificationResponse,
        prop: ClassifierProperties,
        opts: {
            activeTimeout?: number;
            showNoObjectsFoundNotification: boolean;
        }) {
        const activeTimeout = opts.activeTimeout || 1000;

        if (this._firstInference) {
            if (prop.isPerformanceCalibrationEnabled) {
                this._elements.perfCalHint.style.display = '';
            }
            else {
                this._elements.perfCalHint.style.display = 'none';
            }
        }

        if (this._firstInference && res.results.length > 0) {
            this._firstInference = false;
            this._isObjectDetection = typeof res.results[0].x === 'number';

            if (!this._isObjectDetection) {
                this._elements.inferencingResult.style.visibility = '';

                let thead = <HTMLElement>
                    this._elements.inferencingResultTable.querySelector('thead tr');
                if (this.showOnlyTopResults(res)) {
                    // only 1 results th
                    let th = document.createElement('th');
                    th.scope = 'col';
                    th.textContent = 'Top 5 results';
                    th.classList.add('px-0', 'text-center');
                    thead.appendChild(th);
                }
                else {
                    for (let e of res.results) {
                        let th = document.createElement('th');
                        th.scope = 'col';
                        th.textContent = e.label;
                        th.classList.add('px-0', 'text-center');
                        thead.appendChild(th);
                    }
                }
                if (res.anomaly !== 0.0) {
                    let th = document.createElement('th');
                    th.scope = 'col';
                    th.textContent = 'anomaly';
                    th.classList.add('px-0', 'text-center');
                    thead.appendChild(th);
                }
                if (res.has_visual_anomaly_detection) {
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

        for (let bx of Array.from(
            this._elements.cameraInner.querySelectorAll('.bounding-box-container'))) {

            bx.parentNode?.removeChild(bx);
        }

        let heightFactor = Number(this._elements.cameraCanvas.height) /
            Number(this._elements.cameraVideo.clientHeight);

        let widthFactor = Number(this._elements.cameraCanvas.width) /
            Number(this._elements.cameraVideo.clientWidth);

        if (!this._isObjectDetection && res.results.length > 0) {
            let tbody = <HTMLElement>this._elements.inferencingResultTable.querySelector('tbody');
            let row = document.createElement('tr');
            row.innerHTML = '<td class="pl-4 pr-0">' + (++this._inferenceCount) + '</td>';
            row.classList.add('active');

            setTimeout(() => {
                row.classList.remove('active');
            }, activeTimeout);

            // more than 10 classes?
            if (this.showOnlyTopResults(res)) {
                // only print top 5
                let td = document.createElement('td');

                const top = res.results.sort((a, b) => b.value - a.value).slice(0, 5);
                for (let ix = 0; ix < top.length; ix++) {
                    let span = ix === 0 ? document.createElement('strong') : document.createElement('span');
                    span.textContent = `${top[ix].label}: ${top[ix].value.toFixed(2)}`;
                    td.appendChild(span);

                    if (ix !== top.length - 1) {
                        let commaSpan = document.createElement('span');
                        commaSpan.textContent = ', ';
                        td.appendChild(commaSpan);
                    }
                }

                row.appendChild(td);
            }
            else {
                for (let e of res.results) {
                    let td = document.createElement('td');
                    td.textContent = e.value.toFixed(2);
                    td.classList.add('px-0', 'text-center');
                    if (Math.max(...res.results.map(v => v.value)) === e.value &&
                        res.visual_ad_grid_cells.length === 0) {
                        td.classList.add('font-weight-bold');
                    }
                    else {
                        td.classList.add('text-gray');
                    }

                    row.appendChild(td);
                }
            }

            if (res.anomaly !== 0.0) {
                let td = document.createElement('td');
                td.textContent = res.anomaly.toFixed(2);
                td.classList.add('px-0', 'text-center');
                row.appendChild(td);
            }

            if (res.has_visual_anomaly_detection) {
                let td = document.createElement('td');
                td.textContent = (res.visual_ad_max || 0).toFixed(2);
                td.classList.add('px-0', 'text-center');
                if (res.visual_ad_grid_cells.length > 0) {
                    td.classList.add('font-weight-bold');
                }
                else {
                    td.classList.add('text-gray');
                }
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
            if (res.results.length === 0 && res.visual_ad_grid_cells.length === 0 &&
                opts.showNoObjectsFoundNotification) {
                Notify.notify('', 'No objects found', 'top', 'center',
                    'fas fa-exclamation-triangle', 'success');
            }

            for (let b of res.object_tracking_results || res.results) {
                if (typeof b.x !== 'number' ||
                    typeof b.y !== 'number' ||
                    typeof b.width !== 'number' ||
                    typeof b.height !== 'number') {
                    continue;
                }
                let bb = {
                    x: b.x / widthFactor,
                    y: b.y / heightFactor,
                    width: b.width / widthFactor,
                    height: b.height / heightFactor,
                    label: 'object_id' in b ?
                        `${b.label} (ID ${b.object_id})` :
                        b.label,
                    value: 'value' in b ? b.value : undefined,
                };

                if (!this._labelToColor[bb.label]) {
                    this._labelToColor[bb.label] = this._colors[this._colorIx++ % this._colors.length];
                }

                let color = this._labelToColor[bb.label];

                let el = document.createElement('div');
                el.classList.add('bounding-box-container');
                el.style.position = 'absolute';
                el.style.border = 'solid 3px ' + color;

                if (prop.modelType === 'object_detection') {
                    el.style.width = (bb.width) + 'px';
                    el.style.height = (bb.height) + 'px';
                    el.style.left = (bb.x) + 'px';
                    el.style.top = (bb.y) + 'px';
                }
                else if (prop.modelType === 'constrained_object_detection') {
                    let centerX = bb.x + (bb.width / 2);
                    let centerY = bb.y + (bb.height / 2);

                    el.style.borderRadius = '10px';
                    el.style.width = 20 + 'px';
                    el.style.height = 20 + 'px';
                    el.style.left = (centerX - 10) + 'px';
                    el.style.top = (centerY - 10) + 'px';
                }

                // Render label and/or scores. For object detection and FOMO,
                // we add a label with class and score.
                let label = document.createElement('div');
                label.classList.add('bounding-box-label');
                label.style.background = color;
                label.textContent = bb.label;
                if (typeof bb.value === 'number') {
                    label.textContent += ' (' + bb.value.toFixed(2) + ')';
                }
                if (prop.modelType === 'constrained_object_detection') {
                    el.style.whiteSpace = 'nowrap';
                }
                el.appendChild(label);

                this._elements.cameraInner.appendChild(el);
            }
        }


        for (let b of res.visual_ad_grid_cells) {
            if (typeof b.x !== 'number' ||
                typeof b.y !== 'number' ||
                typeof b.width !== 'number' ||
                typeof b.height !== 'number') {
                continue;
            }
            let bb = {
                x: b.x / widthFactor,
                y: b.y / heightFactor,
                width: b.width / widthFactor,
                height: b.height / heightFactor,
                label: b.label,
                value: b.value
            };

            let el = document.createElement('div');
            el.classList.add('bounding-box-container');
            el.style.position = 'absolute';
            // Fill container for visual AD, else use a border
            el.style.background = 'rgba(255, 0, 0, 0.5)';

            el.style.width = (bb.width) + 'px';
            el.style.height = (bb.height) + 'px';
            el.style.left = (bb.x) + 'px';
            el.style.top = (bb.y) + 'px';

            // Render label and/or scores. For visual AD, the score is printed
            // in the middle of the bounding box.
            let score = document.createElement('div');
            score.style.fontSize = `${Math.min(20, bb.width * 0.4)}px`;
            score.style.color = 'white';
            score.textContent = bb.value > 1 ? bb.value.toFixed(1) : bb.value.toFixed(2);
            el.appendChild(score);

            // Center align the score
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            el.style.justifyContent = 'center';

            this._elements.cameraInner.appendChild(el);
        }
    }

    private bindThresholdSettings(thresholds: ClassifierThresholds | undefined) {
        this._elements.thresholdsBody.innerHTML = '';

        let h3 = document.createElement('h3');
        h3.textContent = 'Thresholds';
        this._elements.thresholdsBody.appendChild(h3);

        if (!thresholds) {
            let msgEl = document.createElement('div');
            let emEl = document.createElement('em');
            emEl.classList.add('text-sm');
            emEl.textContent = 'Model does not support setting thresholds. Re-build the eim file to change the thresholds.';
            msgEl.appendChild(emEl);
            this._elements.thresholdsBody.appendChild(msgEl);
            return;
        }

        if (thresholds.length === 0) {
            let msgEl = document.createElement('div');
            let emEl = document.createElement('em');
            emEl.classList.add('text-sm');
            emEl.textContent = 'Model does not have any settable thresholds.';
            msgEl.appendChild(emEl);
            this._elements.thresholdsBody.appendChild(msgEl);
            return;
        }

        let thresholdsDiv = document.createElement('div');
        thresholdsDiv.classList.add('mb--3');

        for (let thresholdStrongTyped of thresholds) {
            const threshold = <{ id: number } & { [ k: string ]: number | boolean }><unknown>thresholdStrongTyped;

            for (let k of Object.keys(threshold)) {
                if (k === 'id' || k === 'type') continue;
                if (typeof threshold[k] !== 'number' && typeof threshold[k] !== 'boolean') continue;

                const LS_KEY = `threshold-${this._classifier?.getProject().id}-${threshold.id}-${k}`;

                let rowEl = document.createElement('div');
                rowEl.classList.add('mb-3');

                let labelEl = document.createElement('label');
                labelEl.classList.add('form-control-label', 'w-100');
                labelEl.textContent = `${threshold.type}: ${k} (block ID: ${threshold.id})`;
                rowEl.appendChild(labelEl);

                const valueFromLs = localStorage.getItem(LS_KEY);

                let inputEl = document.createElement('input');

                if (typeof threshold[k] === 'number') {
                    if (valueFromLs && !isNaN(Number(valueFromLs))) {
                        threshold[k] = Number(valueFromLs);
                        this.setThreshold({
                            id: threshold.id,
                            key: k,
                            value: threshold[k],
                        });
                    }

                    inputEl.classList.add('form-control', 'form-control-sm', 'text-default', 'font-monospace');
                    let rounded = Math.round(<number>threshold[k] * 1000) / 1000;
                    inputEl.value = rounded.toString();
                    rowEl.appendChild(inputEl);
                }
                else if (typeof threshold[k] === 'boolean') {
                    if (valueFromLs === 'true' || valueFromLs === 'false') {
                        threshold[k] = valueFromLs === 'true';
                        this.setThreshold({
                            id: threshold.id,
                            key: k,
                            value: threshold[k],
                        });
                    }

                    let cbWrapperEl = document.createElement('div');
                    cbWrapperEl.classList.add('custom-control', 'custom-control-alternative', 'custom-checkbox');

                    inputEl.classList.add('custom-control-input');
                    inputEl.type = 'checkbox';
                    inputEl.autocomplete = 'off';
                    inputEl.checked = threshold[k] ? true : false;
                    inputEl.id = `cb-${threshold.id}-${k}`;

                    let cbLabelEl = document.createElement('label');
                    cbLabelEl.classList.add('custom-control-label', 'pl-2');
                    cbLabelEl.setAttribute('for', inputEl.id);
                    cbLabelEl.textContent = '\xA0'; // &nbsp;

                    cbWrapperEl.appendChild(inputEl);
                    cbWrapperEl.appendChild(cbLabelEl);

                    rowEl.appendChild(cbWrapperEl);
                }


                thresholdsDiv.appendChild(rowEl);

                inputEl.oninput = () => {
                    if (typeof threshold[k] === 'number') {
                        if (!inputEl.value || isNaN(Number(inputEl.value))) return;

                        if (k === 'min_score' && Number(inputEl.value) <= 0) return;

                        threshold[k] = Number(inputEl.value);
                    }
                    else if (typeof threshold[k] === 'boolean') {
                        threshold[k] = inputEl.checked;
                    }

                    this.setThreshold({
                        id: threshold.id,
                        key: k,
                        value: threshold[k],
                    });

                    localStorage.setItem(LS_KEY, threshold[k].toString());
                };
            }
        }

        this._elements.thresholdsBody.appendChild(thresholdsDiv);

        // prevent closing on click inside the dropdown menu
        const dropdownMenuEl = this._elements.thresholdsCol.querySelector('.dropdown-menu');
        if (dropdownMenuEl) {
            dropdownMenuEl.addEventListener('click', ev => {
                ev.stopPropagation();
            });
        }
    }

    private setThreshold(opts: {
        id: number,
        key: string,
        value: number | boolean,
    }) {
        let obj: { id: number } & { [ k: string ]: number | boolean } = {
            id: opts.id,
        };
        obj[opts.key] = opts.value;

        try {
            this._classifier?.setThreshold(obj);
        }
        catch (ex2) {
            const ex = <Error>ex2;
            Notify.notify('', `Failed to set threshold ${opts.key} on block ID ${opts.id}: ${ex.message || ex.toString()}`, 'top',
                'center', 'far fa-times-circle', 'danger');
        }
    }

    private showOnlyTopResults(res: {
        results: object[],
        visual_ad_grid_cells: object[],
    }) {
        return res.results.length > 10 && res.visual_ad_grid_cells.length === 0;
    }
}

import { getApiKey, getDeviceId, storeApiKey, storeDeviceId, getStudioEndpoint } from "./settings";
import { ISensor } from "./sensors/isensor";
import { CameraSensor } from "./sensors/camera";
import { Uploader } from "./uploader";
import { SampleDetails } from "./models";
import { ClassificationLoader } from "./classification-loader";
import { dataMessage } from "./messages";
import { Notify } from "./notify";

export class CameraDataCollectionClientViews {
    private _views = {
        loading: document.querySelector('#loading-view') as HTMLElement,
        qrcode: document.querySelector('#qrcode-view') as HTMLElement,
        connectionFailed: document.querySelector('#remote-mgmt-failed') as HTMLElement,
        capture: document.querySelector('#capture-camera') as HTMLElement,
        permission: document.querySelector('#permission-view') as HTMLElement
    };

    private _elements = {
        deviceId: document.querySelector('#connected-device-id') as HTMLElement,
        connectionFailedMessage: document.querySelector('#connection-failed-message') as HTMLElement,
        grantPermission: document.querySelector('#grant-permissions-button') as HTMLElement,
        loadingText: document.querySelector('#loading-view-text') as HTMLElement,
        captureButton: document.querySelector('#capture-camera-button') as HTMLElement,
        labelLink: document.querySelector('#camera-label-link') as HTMLAnchorElement,
        labelText: document.querySelector('#camera-label-text') as HTMLElement,
        categoryLink: document.querySelector('#camera-category-link') as HTMLAnchorElement,
        categoryText: document.querySelector('#camera-category-text') as HTMLElement,
        categorySelect: document.querySelector('#camera-category-select') as HTMLSelectElement,
        capturedCount: document.querySelector('#images-capture-count') as HTMLElement
    };

    private _sensors: ISensor[] = [];
    private _numCaptures: number = 0;
    private _uploader: Uploader | undefined;
    private _hmacKey: string = '0';

    async init() {
        storeDeviceId(getDeviceId());

        const camera = new CameraSensor();
        if (!await camera.hasSensor()) {
            this._elements.connectionFailedMessage.textContent = 'No camera detected';
            this.switchView(this._views.connectionFailed);
            return;
        }
        this._sensors.push(camera);

        // if we are not on a platform that overrides the menu action we'll move it to the place
        // of the textbox
        let selectStyle = window.getComputedStyle(this._elements.categorySelect);
        if (selectStyle.webkitAppearance !== 'menulist-button') {
            this._elements.categoryText.style.display = 'none';
            this._elements.categoryText.parentNode?.insertBefore(this._elements.categorySelect,
                this._elements.categoryText);
        }

        if (getApiKey()) {
            storeApiKey(getApiKey());

            try {
                this.switchView(this._views.loading);

                let devKeys = await this.getDevelopmentApiKeys(getApiKey());
                if (devKeys.hmacKey) {
                    this._hmacKey = devKeys.hmacKey;
                }

                this._elements.labelText.textContent = localStorage.getItem('last-camera-label') || 'unknown';
                this._elements.categoryText.textContent = localStorage.getItem('last-camera-category') || 'split';
                this._elements.categorySelect.value = this._elements.categoryText.textContent;

                this._uploader = new Uploader(getApiKey());

                this._elements.grantPermission.textContent = 'Give access to the camera';

                let sensor = this._sensors.find(s => s.getProperties().name.toLowerCase() === 'camera');
                if (sensor && await sensor.checkPermissions(false)) {
                    console.log('sensor checkPermissions OK');
                    this.grantPermission();
                }
                else {
                    this.switchView(this._views.permission);
                    this._elements.grantPermission.onclick = ev => {
                        this.grantPermission();
                    };
                }
            }
            catch (ex) {
                console.error('Failed to load', ex);
                this._elements.connectionFailedMessage.textContent = (ex.message || ex.toString());

                this.switchView(this._views.connectionFailed);
            }
        }
        else {
            this.switchView(this._views.qrcode);
        }

        this._elements.captureButton.onclick = async (ev) => {
            ev.preventDefault();

            if (!this._uploader) return;

            let origHtml = this._elements.captureButton.innerHTML;

            try {
                this._elements.captureButton.innerHTML = '<i class="fa fa-camera mr-2"></i>Uploading...';
                this._elements.captureButton.classList.add('disabled');

                console.log('gonna take sample');

                let sample = await camera.takeSnapshot({ });

                console.log('took sample');

                if (!sample.attachments || sample.attachments.length === 0 || !sample.attachments[0].value) {
                    throw new Error('Attachment is supposed to present');
                }

                let category = this._elements.categoryText.textContent || 'training';
                if (this._elements.categoryText.textContent === 'split') {
                    if (this._numCaptures > 0) {
                        category = await this.getCategoryFromBlob(sample.attachments[0].value);
                    } else {
                        category = 'training'
                    }
                }

                this._numCaptures = this._numCaptures + 1

                let details: SampleDetails = {
                    hmacKey: this._hmacKey,
                    interval: 0,
                    label: this._elements.labelText.textContent || 'unknown',
                    length: 0,
                    path: '/api/' + category + '/data',
                    sensor: 'Camera'
                };

                let data = dataMessage({
                    apiKey: getApiKey(),
                    device: {
                        deviceId: getDeviceId(),
                        sensors: [ camera ].map(s => {
                            let p = s.getProperties();
                            return {
                                name: p.name,
                                frequencies: p.frequencies,
                                maxSampleLength: p.maxSampleLength
                            }
                        }),
                        deviceType: 'MOBILE_CLIENT'
                    }
                }, sample);

                console.log('details', details, 'data', data, 'sample', sample);

                // tslint:disable-next-line: no-floating-promises
                (async () => {
                    if (!this._uploader) return;
                    try {
                        let filename = await this._uploader.uploadSample(details, data, sample);
                        (<any>$).notifyClose();
                        Notify.notify('', 'Uploaded "' + filename + '" to ' + category + ' category', 'top', 'center',
                            'far fa-check-circle', 'success');
                    }
                    catch (ex) {
                        (<any>$).notifyClose();
                        Notify.notify('Failed to upload', ex.message || ex.toString(), 'top', 'center',
                            'far fa-times-circle', 'danger');
                    }
                })();

                // give some indication that the button was pressed
                await this.sleep(100);

                let curr = Number(this._elements.capturedCount.textContent || '0');
                this._elements.capturedCount.textContent = (curr + 1).toString();
            }
            catch (ex) {
                alert('Failed to upload: ' + (ex.message || ex.toString()));
            }
            finally {
                this._elements.captureButton.innerHTML = origHtml;
                this._elements.captureButton.classList.remove('disabled');
            }
        }

        this._elements.labelLink.onclick = ev => {
            ev.preventDefault();

            let v = prompt('Enter a label', this._elements.labelText.textContent || '');
            if (v) {
                if (v && this._elements.labelText.textContent !== v) {
                    this._elements.capturedCount.textContent = '0';
                }

                this._elements.labelText.textContent = v.toLowerCase();

                localStorage.setItem('last-camera-label', this._elements.labelText.textContent);
            }
        };

        this._elements.categorySelect.oninput = () => {
            if (this._elements.categoryText.textContent !== this._elements.categorySelect.value) {
                this._elements.capturedCount.textContent = '0';
            }

            this._elements.categoryText.textContent = this._elements.categorySelect.value;

            localStorage.setItem('last-camera-category', this._elements.categoryText.textContent);
        };

        this._elements.categoryLink.onclick = ev => {
            ev.preventDefault();

            console.log('category link click', ev);

            let element = this._elements.categorySelect;

            let event;
            event = document.createEvent('MouseEvents');
            event.initMouseEvent('mousedown', true, true, window, 0, 0, 0, 0, 0,
                false, false, false, false, 0, null);
            element.dispatchEvent(event);

            // this._elements.categorySelect.focus();
        };
    }

    private switchView(view: HTMLElement) {
        for (const k of Object.keys(this._views)) {
            (<{ [k: string]: HTMLElement }>this._views)[k].style.display = 'none';
        }
        view.style.display = '';
    }

    private grantPermission() {
        let sensor = this._sensors.find(s => s.getProperties().name.toLowerCase() === 'camera');
        if (!sensor) {
            this._elements.connectionFailedMessage.textContent = 'Could not find camera';
            this.switchView(this._views.connectionFailed);
            return;
        }

        sensor.checkPermissions(true).then(result => {
            if (result) {
                this.switchView(this._views.capture);

                if (!this._elements.labelText.textContent) {
                    this._elements.labelLink.click();
                }
            }
            else {
                alert('User has rejected camera permissions')
            }
        }).catch(err => {
            console.error(err);
            this._elements.connectionFailedMessage.textContent = err;
            this.switchView(this._views.connectionFailed);
        });
    }

    private sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async getDevelopmentApiKeys(apiKey: string) {
        let l = new ClassificationLoader(getStudioEndpoint(), apiKey);

        let projectId = await l.getProject();

        try {
            return await l.getDevelopmentKeys(projectId.id);
        }
        catch (ex) {
            console.warn('Could not find development keys for project ' + projectId, ex);
            return {
                apiKey: undefined,
                hmacKey: undefined
            };
        }
    }

    private async getCategoryFromBlob(blob: Blob) {
        let hash = await new Promise<string>((resolve, reject) => {
            let a = new FileReader();
            a.readAsArrayBuffer(blob);
            a.onloadend = async () => {
                if (!a.result || typeof a.result === 'string') {
                    return reject('Failed to calculate hash ' + a.error);
                }
                let hashBuffer = await crypto.subtle.digest('SHA-256', a.result);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                resolve(hashHex);
            };
        });

        while (hash.length > 0 && hash[0] === 'f') {
            hash = hash.substr(1);
        }
        if (hash.length === 0) {
            throw new Error('Failed to calculate SHA256 hash of buffer');
        }
        let firstHashChar = hash[0];

        if (['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b' ].indexOf(firstHashChar) > -1) {
            return 'training';
        }
        else {
            return 'testing';
        }
    }
}

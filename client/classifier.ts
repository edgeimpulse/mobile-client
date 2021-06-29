interface WasmRuntimeModule {
    HEAPU8: {
        buffer: Uint8Array;
    };
    onRuntimeInitialized: () => void;
    run_classifier(dataPointer: number, dataLength: number, debug: boolean): {
        result: number;
        anomaly: number;
        size(): number;
        get(index: number): {
            label: string,
            value: number,
            width?: number,
            height?: number,
            x?: number,
            y?: number,
            delete: () => void
        };
    };
    get_properties(): {
        sensor: number;
        frequency: number;
        frame_sample_count: number;
        input_width: number;
        input_height: number;
    };
    _free(pointer: number): void;
    _malloc(bytes: number): number;
}

export type ClassificationResponse = {
    anomaly: number;
    results: { label: string, value: number, width?: number, height?: number, x?: number, y?: number }[];
};

export class EdgeImpulseClassifier {
    private _initialized = false;
    private _module: WasmRuntimeModule;

    constructor(module: WasmRuntimeModule) {
        this._module = module;
        this._module.onRuntimeInitialized = () => {
            this._initialized = true;
        };
    }

    init() {
        if (this._initialized === true) return Promise.resolve();

        return new Promise<void>((resolve) => {
            this._module.onRuntimeInitialized = () => {
                resolve();
                this._initialized = true;
            };
        });
    }

    getProperties() {
        const ret = this._module.get_properties();

        let sensor;
        if (ret.sensor === 0 || ret.sensor === 2) {
            sensor = "accelerometer";
        } else if (ret.sensor === 1) {
            sensor = "microphone";
        } else if (ret.sensor === 3) {
            sensor = "camera";
        } else {
            throw new Error('Unknown sensor.')
        }

        return {
            sensor: sensor,
            frequency: ret.frequency,
            frameSampleCount: ret.frame_sample_count,
            inputWidth: ret.input_width,
            inputHeight: ret.input_height
        };
    }

    classify(rawData: number[], debug = false): ClassificationResponse {
        if (!this._initialized) throw new Error('Module is not initialized');

        const obj = this._arrayToHeap(rawData);

        const ret = this._module.run_classifier(obj.buffer.byteOffset, rawData.length, debug);

        this._module._free(obj.ptr);

        if (ret.result !== 0) {
            throw new Error('Classification failed (err code: ' + ret.result + ')');
        }

        const jsResult: ClassificationResponse = {
            anomaly: ret.anomaly,
            results: []
        };

        for (let cx = 0; cx < ret.size(); cx++) {
            let c = ret.get(cx);
            jsResult.results.push({ label: c.label, value: c.value, x: c.x, y: c.y, width: c.width, height: c.height });
            c.delete();
        }

        return jsResult;
    }

    private _arrayToHeap(data: number[]) {
        const typedArray = new Float32Array(data);
        const numBytes = typedArray.length * typedArray.BYTES_PER_ELEMENT;
        const ptr = this._module._malloc(numBytes);
        const heapBytes = new Uint8Array(this._module.HEAPU8.buffer, ptr, numBytes);
        heapBytes.set(new Uint8Array(typedArray.buffer));
        return { ptr: ptr, buffer: heapBytes };
    }
}

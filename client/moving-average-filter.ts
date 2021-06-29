import { ClassificationResponse } from "./classifier";

export class MovingAverageFilter {
    private _filterSize: number;
    private _state: {
        [k: string]: {
            runningSum: number;
            buffer: number[];
            bufferIdx: number;
        }
    } = { };

    /**
     * Create a moving average filter to smooth over results
     * @param filterSize Size of the filter, e.g. number of classifications per second for audio models
     * @param labels All labels in the model
     */
    constructor(filterSize: number, labels: string[]) {
        this._filterSize = filterSize;
        for (let l of labels) {
            this._state[l] = {
                runningSum: 0,
                buffer: Array.from({ length: filterSize }).map(n => 0),
                bufferIdx: 0
            };
        }
    }

    /**
     * Apply the moving average filter over incoming results
     * @param result Classification results
     * @returns Classification results with the filter applied
     */
    run(result: ClassificationResponse) {
        if (!result.results) {
            throw new Error('Moving average filter is only supported on classification results');
        }

        for (let l of result.results) {
            let maf = this._state[l.label];
            if (!maf) {
                throw new Error('Unexpected label "' + l + '" in classification, was not passed into ' +
                    'constructor of the filter');
            }

            maf.runningSum -= maf.buffer[maf.bufferIdx];
            maf.runningSum += Number(l.value);
            maf.buffer[maf.bufferIdx] = Number(l.value);

            if (++maf.bufferIdx >= this._filterSize) {
                maf.bufferIdx = 0;
            }

            l.value = maf.runningSum / this._filterSize;
        }

        return result;
    }
}
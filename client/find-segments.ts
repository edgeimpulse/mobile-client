export class FindSegments {
    /**
     * Find segments in a data stream
     * @param data Data
     * @param samplesPerWindow Minimum distance between segments (number of datapoints)
     * @param frequency Data frequency
     * @param shiftSegments Whether to shift segments a little bit randomly, or center around the interesting window
     */
    findSegments(data: number[] | number[][], samplesPerWindow: number, frequency: number,
                 shiftSegments: boolean) {
        let combinedData: number[];
        if (typeof data[0] === 'number') {
            combinedData = (<number[]>data);
        }
        else {
            combinedData = (<number[][]>data).map(v => v.reduce((curr, x) => curr + Math.abs(x), 0));
            // combinedData = (<number[][]>data).map(v => Math.max(...v.map(vv => Math.abs(vv))));
        }

        let minSegmentDistance = Math.ceil(samplesPerWindow * 0.85);

        let indices = this.findPeaks(combinedData, minSegmentDistance);

        // center each segment around data
        // find segment position with the most energy
        let segments = indices.map(segmentCenter => {
            // if we have a 1sec window we'll start searching 0.85 sec before the peak
            let searchStart = Math.max(segmentCenter - minSegmentDistance, 0);
            // and end at 1sec after the peak
            let searchEnd = Math.min(segmentCenter + minSegmentDistance, data.length - 1);

            let windows: { start: number, end: number, energy: number }[] = [];

            let frameLength = Math.floor(0.02 * frequency);
            if (frameLength < 1) frameLength = 1;
            let frameStride = Math.floor(0.02 * frequency);
            if (frameStride < 1) frameStride = 1;

            for (let start = searchStart; start < searchEnd - frameLength; start += frameStride) {
                let dataThisWindow = combinedData.slice(start, start + frameLength);
                let energy = dataThisWindow.map(a => a * a).reduce((a, b) => a + b, 0);

                windows.push({
                    start: start,
                    end: start + frameLength,
                    energy: energy
                });
            }

            let mean = this.avg(windows.map(w => w.energy)) * 2;
            windows = windows.filter(x => x.energy > mean); // <-- all interesting windows

            if (windows.length === 0) return undefined;

            let interestingWindows: { start: number, end: number, energy: number }[] = [];
            let currInterestingWindow: { start: number, end: number, energy: number } | undefined;

            for (let w of windows) {
                if (!currInterestingWindow) {
                    currInterestingWindow = w;
                    continue;
                }

                // two windows are less than 200ms. apart? then update the curr window
                if (w.start - currInterestingWindow.end < Math.floor(0.2 * frequency)) {
                    currInterestingWindow.end = w.end;
                    currInterestingWindow.energy += w.energy;
                }
                else {
                    interestingWindows.push(currInterestingWindow);
                    currInterestingWindow = w;
                }
            }

            if (currInterestingWindow) {
                interestingWindows.push(currInterestingWindow);
            }

            let highestEnergy = Math.max(...interestingWindows.map(x => x.energy));
            let mostInterestingWindow = interestingWindows.find(x => x.energy === highestEnergy);
            if (!mostInterestingWindow) {
                // center window around the peak
                return {
                    start: segmentCenter - Math.floor(samplesPerWindow / 2),
                    end: segmentCenter + Math.floor(samplesPerWindow / 2)
                };
            }

            let center = (mostInterestingWindow.end + mostInterestingWindow.start) / 2;
            let begin = center - Math.floor(samplesPerWindow / 2);
            let end = center + Math.floor(samplesPerWindow / 2);

            if (shiftSegments) {
                // we randomly want to shift the window, but never cut out any data
                // first determine the direction
                let shiftDirection = Math.random() >= 0.5 ? 'left' : 'right';
                // max shift depends on the interesting window we found minus 100ms. (just in case)
                let maxShift = Math.floor((samplesPerWindow -
                    (mostInterestingWindow.end - mostInterestingWindow.start) - (0.1 * frequency))) / 2;
                if (maxShift > 0) {
                    let shiftAmount = Math.floor(maxShift * Math.random());

                    if (shiftDirection === 'left') {
                        begin -= shiftAmount;
                        end -= shiftAmount;
                    }
                    else {
                        begin += shiftAmount;
                        end += shiftAmount;
                    }
                }
            }

            if (begin < 0) {
                let diff = 0 - begin;
                begin += diff;
                end += diff;
            }
            if (end > combinedData.length) {
                let diff = end - combinedData.length;
                begin -= diff;
                end -= diff;
            }

            return {
                start: begin,
                end: end
            };
        });

        let allSegments: { start: number, end: number }[] = [];
        let lastSegment: { start: number, end: number } | undefined;
        for (let s of segments) {
            if (typeof s === 'undefined') continue;

            // max. 15% overlap between windows
            if (lastSegment && s.start - lastSegment.end < -0.15 * samplesPerWindow) {
                continue;
            }

            lastSegment = s;
            allSegments.push(s);
        }

        allSegments = allSegments.filter(s => {
            let d = <number[]>data.slice(s.start, s.end);
            let squares = d.map(v => v * v);
            let sum = squares.reduce((curr, v) => (curr + v));
            let mean = sum / data.length;
            console.log('Found segment', s, mean);
            if (mean < 100000) {
                return false;
            }
            return true;
        });

        if (data.length !== samplesPerWindow && allSegments.length === 1 && allSegments[0].start === 0) {
            return [];
        }

        return allSegments;
    }

    private avg(signal: number[]): number {
        return signal.reduce((a, b) => a + b, 0) / signal.length;
    }

    /**
     * Port of the scipy findpeaks function
     * @param data Array of data items
     * @param distance Distance between peaks (number of datapoints)
     * @param rmsThreshold RMS threshold for peaks (percentage of full data RMS)
     * @returns indices in the data list of the found peaks
     */
    private findPeaks(data: number[], distance: number) {
        // Calculate the RMS as the min peak height required
        // remove mean first...

        let totalMean = this.avg(data);
        data = data.map(d => d - totalMean);

        let squares = data.map(v => v * v);
        let sum = squares.reduce((curr, v) => (curr + v));
        let mean = sum / data.length;
        let threshold = Math.sqrt(mean) * 1.2;

        let peaks = [];
        for (let ix = 1; ix < data.length - 1; ix++) {
            let prev = data[ix - 1];
            let next = data[ix + 1];
            if (data[ix] >= prev && data[ix] > next && data[ix] > threshold) {
                peaks.push(ix);
            }
        }

        let priority = peaks.map(x => data[x]);
        let peaksSize = peaks.length;

        // np.argsort equivalent
        let sorted = Array.from(priority).map((v, ix) => ({
            ix: ix,
            value: v
        })).sort((a, b) => b.value - a.value).reverse();

        let priorityToPosition: number[] = new Array(peaks.length).fill(0);

        for (let sx = 0; sx < sorted.length; sx++) {
            priorityToPosition[sx] = sorted[sx].ix;
        }

        let keep = new Array(peaks.length).fill(1);

        for (let i = peaksSize - 1; i >= 0; i--) {
            let j = priorityToPosition[i];
            if (keep[j] === 0) {
                continue;
            }

            let k = j - 1;
            while (0 <= k && peaks[j] - peaks[k] < distance) {
                keep[k] = 0;
                k -= 1;
            }

            k = j + 1;
            while (k < peaksSize && peaks[k] - peaks[j] < distance) {
                keep[k] = 0;
                k += 1;
            }
        }

        let indices = [];
        for (let kx = 0; kx < keep.length; kx++) {
            if (keep[kx] === 1) {
                indices.push(peaks[kx]);
            }
        }

        return indices;
    }
}

import { SampleDetails, Sample } from "./models";
import { dataMessage } from "./messages";
import { createSignature } from "./utils";
import { getIngestionApi } from "./settings";

export class Uploader {
    private _apiKey: string;

    constructor(apiKey: string) {
        this._apiKey = apiKey;
    }

    private encodeLabel(header: string): string {
        let encodedHeader;
        try {
            encodedHeader = encodeURIComponent(header);
        }
        catch (ex) {
            encodedHeader = header;
        }

        return encodedHeader;
    }

    async uploadSample(
        details: SampleDetails,
        data: ReturnType < typeof dataMessage >,
        sampleData: Sample
    ): Promise<string> {
        console.log('uploader uploadSample', details, data, sampleData);

        data.signature = await createSignature(details.hmacKey, data);

        let formData = new FormData();
        formData.append("message", new Blob([ (JSON.stringify(data))],
            { type: "application/json"}), "message.json");
        if (sampleData.attachments && sampleData.attachments[0].value) {
            formData.append("image", sampleData.attachments[0].value, "image.jpg");
        }

        return new Promise<string>((resolve: any, reject: any) => {

            let xml = new XMLHttpRequest();
            xml.onload = () => {
                if (xml.status === 200) {
                    resolve(xml.responseText);
                }
                else {
                    reject('Failed to upload (status code ' + xml.status + '): ' + xml.responseText);
                }
            };
            xml.onerror = () => reject();
            xml.open("post", getIngestionApi() + details.path)
            xml.setRequestHeader("x-api-key", this._apiKey)
            xml.setRequestHeader("x-file-name", this.encodeLabel(details.label))
            xml.send(formData);
        });
    }
}
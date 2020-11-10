const REMOTE_MANAGEMENT_ENDPOINT = 'wss://remote-mgmt.edgeimpulse.com';
const INGESTION_API = 'https://ingestion.edgeimpulse.com';
const STUDIO_ENDPOINT = 'https://studio.edgeimpulse.com';
const LS_API_KEY = 'apiKey';
const LS_DEVICE_ID_KEY = 'deviceId';
const LS_INGESTION_API = 'ingestionApi';
const LS_REMOTE_MANAGEMENT_ENDPOINT = 'remoteMgmtEndpoint';
const LS_STUDIO_ENDPOINT = 'studioEndpoint';

const getRandomString = () =>
    Date.now().toString(36);

export const getApiKey = () =>
    new URLSearchParams(window.location.search).get('apiKey') ||
    localStorage.getItem(LS_API_KEY) ||
    '';
export const storeApiKey = (apiKey: string) => {
    console.log('storeApiKey', apiKey, window.location.search);
    localStorage.setItem(LS_API_KEY, apiKey);
};

export const getDeviceId = () =>
    localStorage.getItem(LS_DEVICE_ID_KEY) || `phone_${getRandomString()}`;
export const storeDeviceId = (deviceId: string) => {
    localStorage.setItem(LS_DEVICE_ID_KEY, deviceId);
};

export const getIngestionApi = () => {
    let ingestionApiParam = new URLSearchParams(window.location.search).get('ingestionApi')
    let envParam = new URLSearchParams(window.location.search).get('env')
    let localStorageParam = localStorage.getItem(LS_INGESTION_API)
    if (ingestionApiParam) {
        return ingestionApiParam;
    } else if (envParam) {
        return "http://ingestion." + envParam + ".test.edgeimpulse.com"
    } else if (localStorageParam) {
        return localStorageParam
    } else {
        if (window.location.host === 'smartphone.acc2.edgeimpulse.com') {
            return INGESTION_API.replace('edgeimpulse.com', 'acc2.edgeimpulse.com')
        } else {
            return INGESTION_API
        }
    }
}

export const storeIngestionApi = (ingestionApi: string) => {
    console.log('storeIngestionApi', ingestionApi);
    localStorage.setItem(LS_INGESTION_API, ingestionApi);
};

export const getRemoteManagementEndpoint = () => {
    let remoteMgmtParam = new URLSearchParams(window.location.search).get('remoteManagement')
    let envParam = new URLSearchParams(window.location.search).get('env')
    let localStorageParam = localStorage.getItem(LS_REMOTE_MANAGEMENT_ENDPOINT)
    if (remoteMgmtParam) {
        return remoteMgmtParam;
    } else if (envParam) {
        return "ws://remote-mgmt." + envParam + ".test.edgeimpulse.com"
    } else if (localStorageParam) {
        return localStorageParam
    } else {
        if (window.location.host === 'smartphone.acc2.edgeimpulse.com') {
            return REMOTE_MANAGEMENT_ENDPOINT.replace('edgeimpulse.com', 'acc2.edgeimpulse.com')
        } else {
            return REMOTE_MANAGEMENT_ENDPOINT
        }
    }
}

export const storeRemoteManagementEndpoint = (remoteManagementEndpoint: string) => {
    console.log('storeRemoteManagementEndpoint', remoteManagementEndpoint);
    localStorage.setItem(LS_REMOTE_MANAGEMENT_ENDPOINT, remoteManagementEndpoint);
};

export const getStudioEndpoint = () => {
    let studioParam = new URLSearchParams(window.location.search).get('studio')
    let envParam = new URLSearchParams(window.location.search).get('env')
    let localStorageParam = localStorage.getItem(LS_STUDIO_ENDPOINT)
    if (studioParam) {
        return studioParam;
    } else if (envParam) {
        return "http://studio." + envParam + ".test.edgeimpulse.com"
    } else if (localStorageParam && localStorageParam.indexOf('wss://') === -1) {
        return localStorageParam
    } else {
        if (window.location.host === 'smartphone.acc2.edgeimpulse.com') {
            return STUDIO_ENDPOINT.replace('edgeimpulse.com', 'acc2.edgeimpulse.com')
        } else {
            return STUDIO_ENDPOINT
        }
    }
}

export const storeStudioEndpoint = (studioEndpoint: string) => {
    console.log('storeStudioEndpoint', studioEndpoint);
    localStorage.setItem(LS_STUDIO_ENDPOINT, studioEndpoint);
};
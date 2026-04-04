export const createBlobUrl = async (base64: string): Promise<string> => {
    const response = await fetch(`data:image/jpeg;base64,${base64}`);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
};

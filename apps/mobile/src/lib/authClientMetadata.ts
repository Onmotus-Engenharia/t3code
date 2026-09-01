import type { AuthClientPresentationMetadata } from "@t3tools/contracts";
import * as Device from "expo-device";
import { Platform } from "react-native";

export function authClientMetadata(appVersion?: string): AuthClientPresentationMetadata {
  const osMajorVersion = Number.parseInt(Device.osVersion?.split(".")[0] ?? "", 10);
  const deviceModel = Device.modelName?.trim();
  const runtimeDevice = Device as unknown as {
    readonly deviceType?: number;
    readonly DeviceType?: { readonly TABLET: number; readonly PHONE: number };
  };

  return {
    label: "T3 Code Mobile",
    deviceType:
      runtimeDevice.deviceType === runtimeDevice.DeviceType?.TABLET
        ? "tablet"
        : runtimeDevice.deviceType === runtimeDevice.DeviceType?.PHONE
          ? "mobile"
          : "unknown",
    ...(Platform.OS === "ios" ? { os: "iOS" } : Platform.OS === "android" ? { os: "Android" } : {}),
    ...(Number.isFinite(osMajorVersion) && osMajorVersion > 0 ? { osMajorVersion } : {}),
    ...(deviceModel ? { deviceModel } : {}),
    surface: "mobile",
    ...(appVersion ? { appVersion } : {}),
  };
}

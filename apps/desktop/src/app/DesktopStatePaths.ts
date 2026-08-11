export type JoinPath = (first: string, ...segments: string[]) => string;

const normalizeConfiguredBaseDir = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly configuredBaseDir: string | undefined;
  readonly defaultBaseDirName: string;
}): string {
  return (
    normalizeConfiguredBaseDir(input.configuredBaseDir) ??
    input.joinPath(input.homeDirectory, input.defaultBaseDirName)
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly configuredBaseDir: string | undefined;
  readonly developmentStateDirName: string;
  readonly stateDirName: string;
}): string {
  const useDevSubdir =
    input.isDevelopment && normalizeConfiguredBaseDir(input.configuredBaseDir) === null;
  return input.joinPath(
    input.baseDir,
    useDevSubdir ? input.developmentStateDirName : input.stateDirName,
  );
}

import { useAuth } from "@clerk/expo";
import { AuthView, UserProfileView } from "@clerk/expo/native";
import { StackActions, useNavigation } from "@react-navigation/native";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { ComponentType, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { View } from "react-native";

import { hasCloudPublicConfig } from "../cloud/publicConfig";

type HostBackCompatibleProps<Props> = Props & {
  /** Clerk's native views support this at runtime, but it is absent from v4.2's exported props. */
  onHostBack?: () => void;
};

function withHostBack<Props>(View: ComponentType<Props>) {
  return View as ComponentType<HostBackCompatibleProps<Props>>;
}

const AuthViewWithHostBack = withHostBack(AuthView);
const UserProfileViewWithHostBack = withHostBack(UserProfileView);

export function SettingsAuthRouteScreen() {
  const navigation = useNavigation();

  useLayoutEffect(() => {
    if (!hasCloudPublicConfig()) {
      navigation.dispatch(StackActions.replace("SettingsContent"));
    }
  }, [navigation]);

  return hasCloudPublicConfig() ? <ConfiguredSettingsAuthRouteScreen /> : null;
}

function ConfiguredSettingsAuthRouteScreen() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const navigation = useNavigation();
  const handleHostBack = useCallback(
    () => navigation.dispatch(StackActions.popTo("SettingsContent")),
    [navigation],
  );
  const hasBeenSignedIn = useRef(isSignedIn);
  if (isSignedIn) {
    hasBeenSignedIn.current = true;
  }

  useEffect(() => {
    if (hasBeenSignedIn.current && isLoaded && isSignedIn === false) {
      navigation.dispatch(StackActions.popTo("SettingsContent"));
    }
  }, [isLoaded, isSignedIn, navigation]);

  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <View collapsable={false} className="flex-1 overflow-hidden bg-sheet">
        {isLoaded ? (
          hasBeenSignedIn.current ? (
            <UserProfileViewWithHostBack isDismissible={false} onHostBack={handleHostBack} />
          ) : (
            <AuthViewWithHostBack isDismissible={false} onHostBack={handleHostBack} />
          )
        ) : null}
      </View>
    </>
  );
}

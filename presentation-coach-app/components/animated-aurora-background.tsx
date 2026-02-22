import React, { ReactNode, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

type AnimatedAuroraBackgroundProps = {
  children: ReactNode;
};

export function AnimatedAuroraBackground({ children }: AnimatedAuroraBackgroundProps) {
  const driftA = useRef(new Animated.Value(0)).current;
  const driftB = useRef(new Animated.Value(0)).current;
  const driftC = useRef(new Animated.Value(0)).current;
  const fadeA = useRef(new Animated.Value(0.6)).current;
  const fadeB = useRef(new Animated.Value(0.52)).current;
  const fadeC = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loopA = Animated.loop(
      Animated.sequence([
        Animated.timing(driftA, {
          toValue: 1,
          duration: 26000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(driftA, {
          toValue: 0,
          duration: 26000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const loopB = Animated.loop(
      Animated.sequence([
        Animated.timing(driftB, {
          toValue: 1,
          duration: 32000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(driftB, {
          toValue: 0,
          duration: 32000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    const loopC = Animated.loop(
      Animated.sequence([
        Animated.timing(driftC, {
          toValue: 1,
          duration: 38000,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(driftC, {
          toValue: 0,
          duration: 38000,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );

    const pulseA = Animated.loop(
      Animated.sequence([
        Animated.timing(fadeA, {
          toValue: 0.78,
          duration: 14000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(fadeA, {
          toValue: 0.55,
          duration: 14000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const pulseB = Animated.loop(
      Animated.sequence([
        Animated.timing(fadeB, {
          toValue: 0.7,
          duration: 17000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(fadeB, {
          toValue: 0.48,
          duration: 17000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const pulseC = Animated.loop(
      Animated.sequence([
        Animated.timing(fadeC, {
          toValue: 0.62,
          duration: 22000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(fadeC, {
          toValue: 0.4,
          duration: 22000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    loopA.start();
    loopB.start();
    loopC.start();
    pulseA.start();
    pulseB.start();
    pulseC.start();

    return () => {
      loopA.stop();
      loopB.stop();
      loopC.stop();
      pulseA.stop();
      pulseB.stop();
      pulseC.stop();
    };
  }, [driftA, driftB, driftC, fadeA, fadeB, fadeC]);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#090f23', '#171d47', '#103b4a']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <Animated.View
        pointerEvents="none"
        style={[
          styles.layerA,
          {
            opacity: fadeA,
            transform: [
              { translateX: driftA.interpolate({ inputRange: [0, 1], outputRange: [-120, 140] }) },
              { translateY: driftA.interpolate({ inputRange: [0, 1], outputRange: [-90, 80] }) },
              { rotate: '-17deg' },
            ],
          },
        ]}>
        <LinearGradient
          colors={['rgba(45, 73, 176, 0)', 'rgba(58, 89, 200, 0.34)', 'rgba(45, 73, 176, 0)']}
          start={{ x: 0, y: 0.15 }}
          end={{ x: 1, y: 0.9 }}
          style={styles.layerFill}
        />
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.layerB,
          {
            opacity: fadeB,
            transform: [
              { translateX: driftB.interpolate({ inputRange: [0, 1], outputRange: [150, -170] }) },
              { translateY: driftB.interpolate({ inputRange: [0, 1], outputRange: [90, -110] }) },
              { rotate: '21deg' },
            ],
          },
        ]}>
        <LinearGradient
          colors={['rgba(31, 185, 173, 0)', 'rgba(34, 190, 176, 0.33)', 'rgba(31, 185, 173, 0)']}
          start={{ x: 0.05, y: 0.2 }}
          end={{ x: 0.95, y: 0.85 }}
          style={styles.layerFill}
        />
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.layerC,
          {
            opacity: fadeC,
            transform: [
              { translateX: driftC.interpolate({ inputRange: [0, 1], outputRange: [-100, 120] }) },
              { translateY: driftC.interpolate({ inputRange: [0, 1], outputRange: [120, -70] }) },
              { rotate: '-9deg' },
            ],
          },
        ]}>
        <LinearGradient
          colors={['rgba(61, 104, 214, 0)', 'rgba(61, 104, 214, 0.2)', 'rgba(61, 104, 214, 0)']}
          start={{ x: 0.1, y: 0.15 }}
          end={{ x: 0.9, y: 0.95 }}
          style={styles.layerFill}
        />
      </Animated.View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  layerA: {
    position: 'absolute',
    top: '-40%',
    left: '-42%',
    width: '190%',
    height: '160%',
  },
  layerB: {
    position: 'absolute',
    top: '-30%',
    right: '-45%',
    width: '195%',
    height: '170%',
  },
  layerC: {
    position: 'absolute',
    left: '-35%',
    bottom: '-62%',
    width: '200%',
    height: '180%',
  },
  layerFill: {
    flex: 1,
  },
});

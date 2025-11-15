import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Analysis } from '@analyzer';
import {
    createAddressResolver,
    type AddressLookupOptions,
    type AddressLookupResult,
} from '@analyzer/analysis/address-resolver';

interface AddressResolutionContextValue {
    resolveAddress: (address: number, options?: AddressLookupOptions) => AddressLookupResult | null;
    hasResolver: boolean;
}

const defaultContext: AddressResolutionContextValue = {
    resolveAddress: () => null,
    hasResolver: false,
};

const AddressResolutionContext = createContext<AddressResolutionContextValue>(defaultContext);

interface AddressResolutionProviderProps {
    analysis?: Analysis | null;
    children: ReactNode;
}

export const AddressResolutionProvider = ({ analysis, children }: AddressResolutionProviderProps): JSX.Element => {
    const resolver = useMemo(() => (analysis ? createAddressResolver(analysis) : null), [analysis]);

    const value = useMemo<AddressResolutionContextValue>(() => {
        if (!resolver) {
            return defaultContext;
        }
        return {
            resolveAddress: (address, options) => resolver.resolve(address, options),
            hasResolver: true,
        } satisfies AddressResolutionContextValue;
    }, [resolver]);

    return <AddressResolutionContext.Provider value={value}>{children}</AddressResolutionContext.Provider>;
};

export const useAddressResolution = (): AddressResolutionContextValue => useContext(AddressResolutionContext);

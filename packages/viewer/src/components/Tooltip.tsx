import {
    cloneElement,
    useCallback,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type FocusEvent,
    type KeyboardEvent,
    type MouseEvent,
    type ReactElement,
    type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type TooltipTrigger = ReactElement<{
    onBlur?: (event: FocusEvent) => void;
    onFocus?: (event: FocusEvent) => void;
    onMouseEnter?: (event: MouseEvent) => void;
    onMouseLeave?: (event: MouseEvent) => void;
    onKeyDown?: (event: KeyboardEvent) => void;
}>;

interface TooltipProps {
    content: ReactNode;
    children: TooltipTrigger;
}

const combine = <EventArg,>(original: ((event: EventArg) => void) | undefined, next: (event: EventArg) => void) =>
    (event: EventArg): void => {
        if (original) {
            original(event);
        }
        next(event);
    };

const Tooltip = ({ content, children }: TooltipProps): JSX.Element => {
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLSpanElement | null>(null);
    const [position, setPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

    const handleShow = useCallback((): void => setOpen(true), []);
    const handleHide = useCallback((): void => setOpen(false), []);

    const updatePosition = useCallback(() => {
        const element = wrapperRef.current;
        if (!element) {
            return;
        }

        const rect = element.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const horizontalCenter = rect.left + rect.width / 2;
        const clampedLeft = Math.min(Math.max(horizontalCenter, 16), viewportWidth - 16);
        const top = rect.bottom + 8;

        setPosition({ left: clampedLeft, top });
    }, []);

    const childProps = useMemo(
        () => ({
            onFocus: combine(children.props.onFocus, handleShow),
            onBlur: combine(children.props.onBlur, handleHide),
            onMouseEnter: combine(children.props.onMouseEnter, handleShow),
            onMouseLeave: combine(children.props.onMouseLeave, handleHide),
            onKeyDown: combine(children.props.onKeyDown, (event: KeyboardEvent) => {
                if (event.key === 'Escape') {
                    handleHide();
                }
            }),
        }),
        [children, handleHide, handleShow],
    );

    useLayoutEffect(() => {
        if (!open) {
            return;
        }

        updatePosition();
        const handleWindowChange = () => updatePosition();

        window.addEventListener('scroll', handleWindowChange, true);
        window.addEventListener('resize', handleWindowChange);

        return () => {
            window.removeEventListener('scroll', handleWindowChange, true);
            window.removeEventListener('resize', handleWindowChange);
        };
    }, [open, updatePosition]);

    if (!content) {
        return children;
    }

    const overlayRoot = typeof document !== 'undefined' ? document.body : null;
    const overlay = open && overlayRoot
        ? createPortal(
            <span className="tooltip-overlay" style={{ left: position.left, top: position.top }}>
                <span className="tooltip-bubble">{content}</span>
            </span>,
            overlayRoot,
        )
        : null;

    return (
        <span className="tooltip" ref={wrapperRef} onMouseEnter={handleShow} onMouseLeave={handleHide} onFocus={handleShow} onBlur={handleHide}>
            {cloneElement(children, childProps)}
            {overlay}
        </span>
    );
};

export default Tooltip;

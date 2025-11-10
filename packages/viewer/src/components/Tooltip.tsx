import {
    cloneElement,
    useCallback,
    useMemo,
    useState,
    type KeyboardEvent,
    type MouseEvent,
    type ReactElement,
    type ReactNode,
    type FocusEvent,
} from 'react';

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

    const handleShow = useCallback((): void => setOpen(true), []);
    const handleHide = useCallback((): void => setOpen(false), []);

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
        [children, children.props.onBlur, children.props.onFocus, children.props.onKeyDown, children.props.onMouseEnter, children.props.onMouseLeave, handleHide, handleShow],
    );

    if (!content) {
        return children;
    }

    return (
        <span className="tooltip" onMouseEnter={handleShow} onMouseLeave={handleHide}>
            {cloneElement(children, childProps)}
            {open ? <span className="tooltip-bubble">{content}</span> : null}
        </span>
    );
};

export default Tooltip;

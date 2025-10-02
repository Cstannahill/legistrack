import { parseMarkdownBold, hasMarkdownBold } from "@/lib/utils/markdown";

interface FormattedTextProps {
    text: string;
    className?: string;
}

/**
 * Renders text with markdown bold (**text**) converted to styled spans
 * Uses Tailwind's font-bold class for styling
 */
export function FormattedText({ text, className = "" }: FormattedTextProps) {
    // Quick check - if no bold syntax, just return plain text
    if (!hasMarkdownBold(text)) {
        return <span className={className}>{text}</span>;
    }

    // Parse and render with bold sections
    const segments = parseMarkdownBold(text);

    return (
        <span className={className}>
            {segments.map((segment, index) => (
                segment.bold ? (
                    <span key={index} className="font-bold">
                        {segment.text}
                    </span>
                ) : (
                    <span key={index}>{segment.text}</span>
                )
            ))}
        </span>
    );
}

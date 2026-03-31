type FieldErrorProps = {
  message?: string;
  id?: string;
};

export function FieldError({ message, id }: FieldErrorProps) {
  if (!message) return null;

  return (
    <p className="text-sm text-destructive" role="alert" id={id}>
      {message}
    </p>
  );
}
